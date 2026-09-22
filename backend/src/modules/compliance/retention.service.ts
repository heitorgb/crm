import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatus } from '@prisma/client';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { PersonalDataService } from './personal-data.service.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  tenantId: string;
  conversations: number;
  messages: number;
  leads: number;
}

@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);
  private readonly isTest: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly personalData: PersonalDataService,
    private readonly activities: ActivitiesService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    config: ConfigService<Env, true>,
  ) {
    this.isTest = config.getOrThrow('NODE_ENV') === 'test';
  }

  async onModuleInit(): Promise<void> {
    this.queue.registerProcessor(JOB_NAMES.RETENTION_TICK, () => this.runAll());
    this.queue.registerProcessor(JOB_NAMES.RETENTION_EXPUNGE, (payload) => this.process(payload));

    if (!this.isTest) {
      await this.queue.scheduleRepeatable(JOB_NAMES.RETENTION_TICK, TICK_INTERVAL_MS, {});
    }
  }

  async runAll(now = new Date()): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      await this.queue.enqueue(JOB_NAMES.RETENTION_EXPUNGE, {
        tenantId: tenant.id,
        reference: now.toISOString(),
      });
    }
  }

  async process(payload: JobPayload): Promise<void> {
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
    if (!tenantId) {
      return;
    }
    await this.expunge(tenantId);
  }

  async expunge(tenantId: string, now = new Date()): Promise<RetentionResult> {
    return this.runAsTenant(tenantId, async () => {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { retentionConversationDays: true, retentionLeadDays: true },
      });
      if (!tenant) {
        return { tenantId, conversations: 0, messages: 0, leads: 0 };
      }

      const conversationCutoff = new Date(now.getTime() - tenant.retentionConversationDays * DAY_MS);
      const leadCutoff = new Date(now.getTime() - tenant.retentionLeadDays * DAY_MS);

      const conversations = await this.prisma.conversation.findMany({
        where: {
          tenantId,
          legalHold: false,
          status: ConversationStatus.CLOSED,
          closedAt: { lte: conversationCutoff },
        },
        select: { id: true },
        take: BATCH_LIMIT,
      });
      const conversationIds = conversations.map((conversation) => conversation.id);

      let messages = 0;
      if (conversationIds.length > 0) {
        const updatedMessages = await this.prisma.message.updateMany({
          where: { tenantId, conversationId: { in: conversationIds } },
          data: { content: null, metadata: {}, externalMessageId: null },
        });
        messages = updatedMessages.count;

        await this.prisma.conversation.updateMany({
          where: { tenantId, id: { in: conversationIds } },
          data: { externalContactId: null, subject: null },
        });
      }

      const leads = await this.prisma.lead.findMany({
        where: {
          tenantId,
          legalHold: false,
          anonymizedAt: null,
          updatedAt: { lte: leadCutoff },
          conversations: { none: { status: { not: ConversationStatus.CLOSED } } },
        },
        select: { id: true },
        take: BATCH_LIMIT,
      });

      let anonymizedLeads = 0;
      for (const lead of leads) {
        try {
          await this.personalData.anonymizeLead(tenantId, lead.id, { recordRequest: false });
          anonymizedLeads += 1;
        } catch {
          // Legal hold or race: skip and continue.
        }
      }

      const result: RetentionResult = {
        tenantId,
        conversations: conversationIds.length,
        messages,
        leads: anonymizedLeads,
      };

      // Logs contain only counts, never the erased content.
      this.logger.log(
        `Retention run tenant=${tenantId} conversations=${result.conversations} messages=${result.messages} leads=${result.leads}`,
      );

      if (result.conversations > 0 || result.leads > 0) {
        await this.activities.record({
          entity: 'tenant',
          entityId: tenantId,
          action: 'retention_expunged',
          metadata: { ...result },
        });
      }

      return result;
    });
  }

  private runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const context: TenantContext = {
      tenantId,
      userId: SYSTEM_USER_ID,
      membershipId: SYSTEM_MEMBERSHIP_ID,
      role: 'SYSTEM',
    };
    return this.tenantContext.run({ tenant: context }, fn);
  }
}
