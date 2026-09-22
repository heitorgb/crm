import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  DigestChannel,
  DigestStatus,
  LeadStatus,
  QualificationOutcome,
  type Prisma,
} from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { EvolutionClient } from '../whatsapp/evolution/evolution.client.js';
import type {
  ListDigestDeliveriesQueryDto,
  UpsertDigestPreferenceDto,
} from './dto/digest.dto.js';
import { DigestPreferenceRequiredError } from './digest.errors.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const TICK_INTERVAL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DigestPreferenceView {
  id: string;
  enabled: boolean;
  frequency: 'DAILY';
  deliveryTime: string;
  timeZone: string;
  channel: DigestChannel;
  whatsappDestination: string | null;
  includeOnlyAssigned: boolean;
  lastDeliveredAt: Date | null;
  updatedAt: Date;
}

export interface DigestDeliveryView {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: DigestStatus;
  leadCount: number;
  channel: DigestChannel;
  externalMessageId: string | null;
  errorCode: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface DigestLeadSummary {
  leadId: string;
  name: string | null;
  phone: string | null;
  score: number | null;
  qualificationLevel: string | null;
  summary: string;
  recommendedNextStep: string | null;
  qualificationReasons: unknown[];
}

export interface DigestOverviewView {
  awaitingDigest: DigestLeadSummary[];
  needsHuman: { conversationId: string; leadName: string | null; status: string }[];
  recentDeliveries: DigestDeliveryView[];
}

interface DigestWindow {
  periodStart: Date;
  periodEnd: Date;
}

@Injectable()
export class LeadDigestService implements OnModuleInit {
  private readonly logger = new Logger(LeadDigestService.name);
  private readonly isTest: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly evolution: EvolutionClient,
    private readonly realtime: RealtimeService,
    private readonly activities: ActivitiesService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    config: ConfigService<Env, true>,
  ) {
    this.isTest = config.getOrThrow('NODE_ENV') === 'test';
  }

  async onModuleInit(): Promise<void> {
    this.queue.registerProcessor(JOB_NAMES.DIGEST_TICK, () => this.runDue(new Date()));
    this.queue.registerProcessor(JOB_NAMES.DIGEST_DELIVER, (payload) => this.processDeliver(payload));

    if (!this.isTest) {
      await this.queue.scheduleRepeatable(JOB_NAMES.DIGEST_TICK, TICK_INTERVAL_MS, {});
    }
  }

  async getPreference(): Promise<DigestPreferenceView | null> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const preference = await this.prisma.leadDigestPreference.findUnique({
      where: { tenantUserId: membershipId },
    });

    return preference && preference.tenantId === tenantId ? toPreferenceView(preference) : null;
  }

  async upsertPreference(dto: UpsertDigestPreferenceDto): Promise<DigestPreferenceView> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const timeZone = validateTimeZone(dto.timeZone);

    const preference = await this.prisma.leadDigestPreference.upsert({
      where: { tenantUserId: membershipId },
      create: {
        tenantId,
        tenantUserId: membershipId,
        enabled: dto.enabled ?? true,
        deliveryTime: dto.deliveryTime,
        timeZone,
        channel: dto.channel ?? DigestChannel.INTERNAL,
        whatsappDestination: dto.whatsappDestination ?? null,
        includeOnlyAssigned: dto.includeOnlyAssigned ?? false,
      },
      update: {
        enabled: dto.enabled ?? true,
        deliveryTime: dto.deliveryTime,
        timeZone,
        channel: dto.channel ?? DigestChannel.INTERNAL,
        whatsappDestination: dto.whatsappDestination ?? null,
        includeOnlyAssigned: dto.includeOnlyAssigned ?? false,
      },
    });

    return toPreferenceView(preference);
  }

  async listDeliveries(
    query: ListDigestDeliveriesQueryDto,
  ): Promise<PageResult<DigestDeliveryView>> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const where: Prisma.LeadDigestDeliveryWhereInput = { tenantId, tenantUserId: membershipId };
    if (query.onlyFailed) {
      where.status = DigestStatus.FAILED;
    }

    const [total, deliveries] = await this.prisma.$transaction([
      this.prisma.leadDigestDelivery.count({ where }),
      this.prisma.leadDigestDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(deliveries.map(toDeliveryView), total, query.page, query.perPage);
  }

  async overview(): Promise<DigestOverviewView> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();

    const [analyses, needsHuman, deliveries] = await Promise.all([
      this.prisma.leadAnalysis.findMany({
        where: {
          tenantId,
          outcome: QualificationOutcome.QUALIFIED,
          lead: { status: LeadStatus.QUALIFIED_WAITING_DIGEST },
        },
        include: { lead: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.conversation.findMany({
        where: { tenantId, status: ConversationStatus.NEEDS_HUMAN },
        include: { lead: true },
        orderBy: { lastMessageAt: 'desc' },
        take: 20,
      }),
      this.prisma.leadDigestDelivery.findMany({
        where: { tenantId, tenantUserId: membershipId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      awaitingDigest: analyses.map((analysis) => ({
        leadId: analysis.leadId,
        name: analysis.lead.name,
        phone: analysis.lead.phone,
        score: analysis.score,
        qualificationLevel: analysis.qualificationLevel,
        summary: analysis.summary,
        recommendedNextStep: analysis.recommendedNextStep,
        qualificationReasons: asItems(analysis.qualificationReasons),
      })),
      needsHuman: needsHuman.map((conversation) => ({
        conversationId: conversation.id,
        leadName: conversation.lead?.name ?? null,
        status: conversation.status,
      })),
      recentDeliveries: deliveries.map(toDeliveryView),
    };
  }

  async runNow(): Promise<void> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const preference = await this.prisma.leadDigestPreference.findUnique({
      where: { tenantUserId: membershipId },
    });

    if (!preference) {
      throw new DigestPreferenceRequiredError();
    }

    const window = computeDigestWindow(new Date(), preference.deliveryTime, preference.timeZone);
    await this.deliver({
      tenantId,
      tenantUserId: membershipId,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
    });
  }

  async runDue(now: Date): Promise<void> {
    const preferences = await this.prisma.leadDigestPreference.findMany({
      where: { enabled: true },
    });

    for (const preference of preferences) {
      const window = computeDigestWindow(now, preference.deliveryTime, preference.timeZone);
      if (now.getTime() < window.periodEnd.getTime()) {
        continue;
      }

      const existing = await this.prisma.leadDigestDelivery.findUnique({
        where: {
          tenantUserId_periodStart: {
            tenantUserId: preference.tenantUserId,
            periodStart: window.periodStart,
          },
        },
      });

      if (
        existing &&
        (existing.status === DigestStatus.SENT ||
          existing.status === DigestStatus.PENDING ||
          existing.status === DigestStatus.SKIPPED)
      ) {
        continue;
      }

      await this.queue.enqueue(JOB_NAMES.DIGEST_DELIVER, {
        tenantId: preference.tenantId,
        tenantUserId: preference.tenantUserId,
        periodStart: window.periodStart.toISOString(),
        periodEnd: window.periodEnd.toISOString(),
      });
    }
  }

  async deliver(input: {
    tenantId: string;
    tenantUserId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<void> {
    await this.runAsTenant(input.tenantId, async () => {
      const preference = await this.prisma.leadDigestPreference.findUnique({
        where: { tenantUserId: input.tenantUserId },
      });
      if (!preference || preference.tenantId !== input.tenantId) {
        return;
      }

      const existing = await this.prisma.leadDigestDelivery.findUnique({
        where: {
          tenantUserId_periodStart: {
            tenantUserId: input.tenantUserId,
            periodStart: input.periodStart,
          },
        },
      });
      if (existing?.status === DigestStatus.SENT) {
        return;
      }

      const analyses = await this.prisma.leadAnalysis.findMany({
        where: {
          tenantId: input.tenantId,
          outcome: QualificationOutcome.QUALIFIED,
          createdAt: { gte: input.periodStart, lt: input.periodEnd },
        },
        include: { lead: true },
        orderBy: { createdAt: 'asc' },
      });
      const pending = analyses.filter(
        (analysis) => analysis.lead.status === LeadStatus.QUALIFIED_WAITING_DIGEST,
      );

      const summaries: DigestLeadSummary[] = pending.map((analysis) => ({
        leadId: analysis.leadId,
        name: analysis.lead.name,
        phone: analysis.lead.phone,
        score: analysis.score,
        qualificationLevel: analysis.qualificationLevel,
        summary: analysis.summary,
        recommendedNextStep: analysis.recommendedNextStep,
        qualificationReasons: asItems(analysis.qualificationReasons),
      }));

      const delivery = await this.prisma.leadDigestDelivery.upsert({
        where: {
          tenantUserId_periodStart: {
            tenantUserId: input.tenantUserId,
            periodStart: input.periodStart,
          },
        },
        create: {
          tenantId: input.tenantId,
          tenantUserId: input.tenantUserId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: DigestStatus.PENDING,
          leadCount: summaries.length,
          channel: preference.channel,
          payloadSnapshot: summaries as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: DigestStatus.PENDING,
          leadCount: summaries.length,
          channel: preference.channel,
          payloadSnapshot: summaries as unknown as Prisma.InputJsonValue,
          errorCode: null,
        },
      });

      const now = new Date();

      if (summaries.length === 0) {
        await this.prisma.leadDigestDelivery.update({
          where: { id: delivery.id },
          data: { status: DigestStatus.SKIPPED, deliveredAt: now },
        });
        return;
      }

      const text = renderDigestText(summaries);

      if (preference.channel === DigestChannel.WHATSAPP) {
        try {
          const instance = await this.prisma.whatsAppInstance.findFirst({
            where: { tenantId: input.tenantId, active: true },
            orderBy: { createdAt: 'asc' },
          });
          const destination = (preference.whatsappDestination ?? '').replace(/\D/g, '');

          if (!this.evolution.configured || !instance || !destination) {
            throw new Error('WhatsApp channel is not available');
          }

          const sent = await this.evolution.sendText(instance.instanceName, destination, text);
          await this.markDelivered(delivery.id, summaries, input, now, sent.externalMessageId ?? null);
          return;
        } catch (error) {
          await this.prisma.leadDigestDelivery.update({
            where: { id: delivery.id },
            data: { status: DigestStatus.FAILED, errorCode: 'DELIVERY_FAILED' },
          });
          this.logger.warn(
            `Digest delivery failed for ${input.tenantUserId}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          throw error;
        }
      }

      if (preference.channel === DigestChannel.EMAIL) {
        await this.prisma.leadDigestDelivery.update({
          where: { id: delivery.id },
          data: { status: DigestStatus.FAILED, errorCode: 'CHANNEL_UNSUPPORTED' },
        });
        return;
      }

      // INTERNAL: always available inside the CRM.
      await this.markDelivered(delivery.id, summaries, input, now, null);
    });
  }

  private async processDeliver(payload: JobPayload): Promise<void> {
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
    const tenantUserId = typeof payload.tenantUserId === 'string' ? payload.tenantUserId : null;
    const periodStart = typeof payload.periodStart === 'string' ? new Date(payload.periodStart) : null;
    const periodEnd = typeof payload.periodEnd === 'string' ? new Date(payload.periodEnd) : null;

    if (!tenantId || !tenantUserId || !periodStart || !periodEnd) {
      return;
    }

    await this.deliver({ tenantId, tenantUserId, periodStart, periodEnd });
  }

  private async markDelivered(
    deliveryId: string,
    summaries: DigestLeadSummary[],
    input: { tenantId: string; tenantUserId: string; periodStart: Date; periodEnd: Date },
    deliveredAt: Date,
    externalMessageId: string | null,
  ): Promise<void> {
    const leadIds = summaries.map((summary) => summary.leadId);

    await this.prisma.$transaction([
      this.prisma.leadDigestDelivery.update({
        where: { id: deliveryId },
        data: { status: DigestStatus.SENT, deliveredAt, externalMessageId },
      }),
      this.prisma.lead.updateMany({
        where: { id: { in: leadIds }, tenantId: input.tenantId },
        data: { status: LeadStatus.ASSIGNED },
      }),
      this.prisma.leadDigestPreference.update({
        where: { tenantUserId: input.tenantUserId },
        data: { lastDeliveredAt: input.periodEnd },
      }),
    ]);

    await this.activities.record({
      entity: 'lead_digest',
      entityId: deliveryId,
      action: 'delivered',
      metadata: { leadCount: summaries.length, periodStart: input.periodStart.toISOString() },
    });

    this.realtime.emitToUser(input.tenantId, input.tenantUserId, 'digest.delivered', {
      deliveryId,
      leadCount: summaries.length,
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

export function computeDigestWindow(now: Date, deliveryTime: string, timeZone: string): DigestWindow {
  const [hours, minutes] = deliveryTime.split(':').map(Number);
  const local = zonedParts(now, timeZone);

  let candidate = zonedTimeToUtc(local.year, local.month, local.day, hours, minutes, timeZone);
  if (candidate.getTime() > now.getTime()) {
    candidate = new Date(candidate.getTime() - DAY_MS);
  }

  return {
    periodEnd: candidate,
    periodStart: new Date(candidate.getTime() - DAY_MS),
  };
}

export function renderDigestText(summaries: DigestLeadSummary[]): string {
  const lines: string[] = [`Leads qualificados: ${summaries.length}`, ''];

  summaries.forEach((summary, index) => {
    const level = summary.qualificationLevel ?? 'n/d';
    const score = summary.score !== null && summary.score !== undefined ? `${summary.score}/100` : 'n/d';
    lines.push(`${index + 1}. ${summary.name ?? summary.phone ?? 'Lead'} — ${score} — ${level}`);
    if (summary.phone) {
      lines.push(`   Contato: ${summary.phone}`);
    }
    lines.push(`   Resumo: ${summary.summary}`);
    if (summary.recommendedNextStep) {
      lines.push(`   Próxima ação: ${summary.recommendedNextStep}`);
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}

function toPreferenceView(preference: {
  id: string;
  enabled: boolean;
  deliveryTime: string;
  timeZone: string;
  channel: DigestChannel;
  whatsappDestination: string | null;
  includeOnlyAssigned: boolean;
  lastDeliveredAt: Date | null;
  updatedAt: Date;
}): DigestPreferenceView {
  return {
    id: preference.id,
    enabled: preference.enabled,
    frequency: 'DAILY',
    deliveryTime: preference.deliveryTime,
    timeZone: preference.timeZone,
    channel: preference.channel,
    whatsappDestination: preference.whatsappDestination,
    includeOnlyAssigned: preference.includeOnlyAssigned,
    lastDeliveredAt: preference.lastDeliveredAt,
    updatedAt: preference.updatedAt,
  };
}

function toDeliveryView(delivery: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: DigestStatus;
  leadCount: number;
  channel: DigestChannel;
  externalMessageId: string | null;
  errorCode: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}): DigestDeliveryView {
  return {
    id: delivery.id,
    periodStart: delivery.periodStart,
    periodEnd: delivery.periodEnd,
    status: delivery.status,
    leadCount: delivery.leadCount,
    channel: delivery.channel,
    externalMessageId: delivery.externalMessageId,
    errorCode: delivery.errorCode,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt,
  };
}

function asItems(value: Prisma.JsonValue): unknown[] {
  return Array.isArray(value) ? value : [];
}

function validateTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    throw new AppException('INVALID_TIME_ZONE', 'Invalid IANA time zone', 400);
  }
}

function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');

  return { year: get('year'), month: get('month'), day: get('day') };
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, 0);
  const offset = timeZoneOffset(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

function timeZoneOffset(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - date.getTime();
}
