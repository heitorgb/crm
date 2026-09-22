import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConversationStatus, MessageStatus, MessageType, Prisma } from '@prisma/client';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { JOB_NAMES, JOB_QUEUE, type JobPayload, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { QualificationSessionsService } from '../qualification/qualification-sessions.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { EvolutionClient } from '../whatsapp/evolution/evolution.client.js';
import { MessagesService } from './messages.service.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';

const NON_TEXT_FALLBACK =
  'No momento consigo ler apenas mensagens de texto. Pode escrever sua resposta, por favor?';

const REVIEW_HINT =
  'Se você achar que essa avaliação está incorreta, responda "falar com atendente" para pedir a revisão de uma pessoa.';

type ConversationWithInstance = Prisma.ConversationGetPayload<{
  include: { instance: true; lead: true };
}>;

@Injectable()
export class ConversationProcessingService implements OnModuleInit {
  private readonly logger = new Logger(ConversationProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly evolution: EvolutionClient,
    private readonly messages: MessagesService,
    private readonly sessions: QualificationSessionsService,
    private readonly tickets: TicketsService,
    private readonly realtime: RealtimeService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.WHATSAPP_MESSAGE, (payload) => this.processMessage(payload));
    this.queue.registerProcessor(JOB_NAMES.WHATSAPP_SEND, (payload) => this.retrySend(payload));
  }

  /** Used by human agents (conversation in HUMAN ownership). */
  async deliverText(tenantId: string, conversationId: string, text: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true, lead: true },
    });
    if (!conversation) {
      return;
    }
    await this.sendText(tenantId, conversation, text);
  }

  async processMessage(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const conversationId = asString(payload.conversationId);
    const messageId = asString(payload.messageId);
    if (!tenantId || !conversationId || !messageId) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        include: { instance: true, lead: true },
      });

      if (!conversation || conversation.status !== ConversationStatus.BOT_QUALIFYING) {
        return;
      }

      const message = await this.prisma.message.findFirst({ where: { id: messageId, tenantId } });
      if (!message || message.direction !== 'INBOUND') {
        return;
      }

      this.realtime.emitToConversation(tenantId, conversation.id, 'message.created', {
        conversationId: conversation.id,
        messageId: message.id,
      });

      const lead = await this.ensureLead(tenantId, conversation, message);
      if (conversation.leadId !== lead.id) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { leadId: lead.id },
        });
      }

      const session = await this.sessions.start(lead.id, {});
      const profile = await this.prisma.qualificationProfile.findFirst({
        where: { id: session.profileId, tenantId },
      });

      const isFirstInteraction = session.questionCount === 0 && !hasLeadMessage(session.transcript);
      if (isFirstInteraction) {
        if (profile?.privacyNoticeText) {
          await this.sendText(tenantId, conversation, profile.privacyNoticeText);
        }
        if (profile?.initialMessage) {
          await this.sendText(tenantId, conversation, profile.initialMessage);
        }
      }

      if (
        (message.content ?? '').trim().length === 0 &&
        message.type !== MessageType.TEXT
      ) {
        await this.sendText(tenantId, conversation, NON_TEXT_FALLBACK);
        return;
      }

      const result = await this.sessions.evaluate(session.id, {
        message: message.content ?? '',
      });

      if (result.decision.action === 'ASK') {
        await this.sendText(tenantId, conversation, result.decision.question);
        await this.touchConversation(conversation.id);
        return;
      }

      if (result.decision.action === 'NEEDS_HUMAN') {
        if (profile?.needsHumanMessage) {
          await this.sendText(tenantId, conversation, profile.needsHumanMessage);
        }
        await this.setConversationStatus(conversation.id, ConversationStatus.NEEDS_HUMAN);
        await this.tickets.ensureHandoffTicket({
          tenantId,
          conversationId: conversation.id,
          leadId: lead.id,
          customerId: conversation.customerId,
          reason: result.decision.reason,
        });
        this.realtime.emitToTenant(tenantId, 'conversation.updated', {
          conversationId: conversation.id,
          status: ConversationStatus.NEEDS_HUMAN,
        });
        return;
      }

      const qualified = result.decision.outcome === 'QUALIFIED';

      if (qualified) {
        if (profile?.qualifiedMessage) {
          await this.sendText(tenantId, conversation, profile.qualifiedMessage);
        }
      } else {
        const base = profile?.disqualifiedMessage ?? '';
        await this.sendText(
          tenantId,
          conversation,
          base.length > 0 ? `${base}\n\n${REVIEW_HINT}` : REVIEW_HINT,
        );
      }

      await this.setConversationStatus(
        conversation.id,
        qualified
          ? ConversationStatus.QUALIFIED_WAITING_DIGEST
          : ConversationStatus.DISQUALIFIED,
      );
      this.realtime.emitToTenant(tenantId, 'conversation.updated', {
        conversationId: conversation.id,
        status: qualified
          ? ConversationStatus.QUALIFIED_WAITING_DIGEST
          : ConversationStatus.DISQUALIFIED,
      });
    });
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
        const sent = await this.evolution.sendText(conversation.instance.instanceName, destination, message.content ?? '');
        await this.messages.markOutboundStatus(messageId, MessageStatus.SENT, sent.externalMessageId);
      } catch (error) {
        await this.messages.markOutboundFailed(messageId, 'EVOLUTION_SEND_FAILED');
        this.logger.warn(
          `Failed to resend message ${messageId}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        throw error;
      }
    });
  }

  private async ensureLead(
    tenantId: string,
    conversation: ConversationWithInstance,
    message: { metadata: Prisma.JsonValue },
  ) {
    if (conversation.leadId && conversation.lead) {
      return conversation.lead;
    }

    const phone = normalizePhone(conversation.externalContactId ?? '');
    if (phone) {
      const existing = await this.prisma.lead.findFirst({ where: { tenantId, phone } });
      if (existing) {
        return existing;
      }
    }

    const pushName = readMetadataString(message.metadata, 'pushName');

    try {
      return await this.prisma.lead.create({
        data: {
          tenantId,
          phone: phone || null,
          name: pushName,
          source: 'whatsapp',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && phone) {
        const existing = await this.prisma.lead.findFirst({ where: { tenantId, phone } });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
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

  private async setConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status,
        lastMessageAt: new Date(),
        ...(status === ConversationStatus.CLOSED ? { closedAt: new Date() } : {}),
      },
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

function hasLeadMessage(transcript: unknown): boolean {
  if (!Array.isArray(transcript)) {
    return false;
  }
  return transcript.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { role?: unknown }).role === 'LEAD',
  );
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function readMetadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
