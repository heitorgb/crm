import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MessageStatus, Prisma } from '@prisma/client';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { EvolutionClient } from '../whatsapp/evolution/evolution.client.js';
import { MessagesService } from './messages.service.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';

type ConversationWithInstance = Prisma.ConversationGetPayload<{ include: { instance: true } }>;

@Injectable()
export class ConversationProcessingService implements OnModuleInit {
  private readonly logger = new Logger(ConversationProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly evolution: EvolutionClient,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.WHATSAPP_SEND, (payload) => this.retrySend(payload));
  }

  /** Delivers a text message written by an agent in the chat. */
  async deliverText(tenantId: string, conversationId: string, text: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true },
    });
    if (!conversation) {
      return;
    }
    await this.sendText(tenantId, conversation, text);
  }

  async retrySend(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const messageId = asString(payload.messageId);
    if (!tenantId || !messageId) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const message = await this.prisma.message.findFirst({
        where: { id: messageId, tenantId },
        include: { conversation: { include: { instance: true } } },
      });

      if (!message || message.direction !== 'OUTBOUND' || message.status === MessageStatus.SENT) {
        return;
      }

      const conversation = message.conversation;
      const destination = normalizePhone(conversation.externalContactId ?? '');

      try {
        if (!this.evolution.configured || !destination) {
          throw new Error('Evolution API not configured or destination missing');
        }
        const sent = await this.evolution.sendText(
          conversation.instance.instanceName,
          destination,
          message.content ?? '',
        );
        await this.messages.markOutboundStatus(messageId, MessageStatus.SENT, sent.externalMessageId);
      } catch (error) {
        await this.messages.markOutboundFailed(messageId, 'EVOLUTION_SEND_FAILED');
        this.logger.warn(
          `Failed to resend message ${messageId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        throw error;
      }
    });
  }

  private async sendText(
    tenantId: string,
    conversation: ConversationWithInstance,
    text: string,
  ): Promise<void> {
    const outbound = await this.messages.persistOutbound({
      tenantId,
      conversationId: conversation.id,
      content: text,
    });

    const destination = normalizePhone(conversation.externalContactId ?? '');

    try {
      if (!this.evolution.configured || !destination) {
        throw new Error('Evolution API not configured or destination missing');
      }
      const sent = await this.evolution.sendText(
        conversation.instance.instanceName,
        destination,
        text,
      );
      await this.messages.markOutboundStatus(outbound.id, MessageStatus.SENT, sent.externalMessageId);
    } catch {
      await this.messages.markOutboundFailed(outbound.id, 'EVOLUTION_SEND_FAILED');
      await this.queue.enqueue(JOB_NAMES.WHATSAPP_SEND, { tenantId, messageId: outbound.id });
    }

    await this.touchConversation(conversation.id);
    this.realtime.emitToConversation(tenantId, conversation.id, 'message.created', {
      conversationId: conversation.id,
      messageId: outbound.id,
    });
  }

  private async touchConversation(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
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

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}
