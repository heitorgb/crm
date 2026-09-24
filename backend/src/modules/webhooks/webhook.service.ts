import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationStatus, MessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { WhatsAppDirectoryService } from '../whatsapp/whatsapp-directory.service.js';
import {
  WhatsAppInstancesService,
  type ResolvedInstance,
} from '../whatsapp/whatsapp-instances.service.js';

export interface WebhookIngestResult {
  accepted: boolean;
  ignored?: string;
  conversationId?: string;
  messageId?: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instances: WhatsAppInstancesService,
    private readonly contacts: ContactsService,
    private readonly directory: WhatsAppDirectoryService,
    private readonly realtime: RealtimeService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async ingestEvolution(payload: unknown): Promise<WebhookIngestResult> {
    if (!isRecord(payload)) {
      return { accepted: false, ignored: 'invalid_payload' };
    }

    const eventType = readString(payload.event) ?? 'unknown';
    const instanceName = readInstanceName(payload);
    if (!instanceName) {
      return { accepted: false, ignored: 'missing_instance' };
    }

    const instance = await this.instances.resolveByInstanceName(instanceName);
    if (!instance) {
      this.logger.warn(`Webhook for unknown or inactive instance: ${instanceName}`);
      return { accepted: false, ignored: 'unknown_instance' };
    }

    const externalEventId = computeEventId(payload, eventType, instanceName);

    const duplicate = await this.recordEvent({
      tenantId: instance.tenantId,
      externalEventId,
      eventType,
      payload,
    });
    if (duplicate) {
      return { accepted: true, ignored: 'duplicate_event' };
    }

    if (eventType === 'groups.upsert' || eventType === 'groups.update') {
      await this.handleGroupUpsert(instance, payload);
      return { accepted: true };
    }

    if (eventType !== 'messages.upsert') {
      return { accepted: true, ignored: 'unsupported_event' };
    }

    const data = isRecord(payload.data) ? payload.data : null;
    const key = data && isRecord(data.key) ? data.key : null;
    const fromMe = key?.fromMe === true;
    const remoteJid = readString(key?.remoteJid);

    if (fromMe || !remoteJid) {
      return { accepted: true, ignored: 'outbound_or_missing_contact' };
    }

    const isGroup = isGroupJid(remoteJid);
    const participant = readString(key?.participant);
    const pushName = readString(data?.pushName);

    const contact = isGroup
      ? null
      : await this.resolveContact(instance.tenantId, extractPhone(remoteJid), pushName);

    const conversation = await this.findOrCreateConversation(
      instance.tenantId,
      instance.id,
      remoteJid,
      contact?.id ?? null,
      isGroup,
    );

    if (isGroup) {
      await this.ensureGroupMetadata(conversation, instance, remoteJid);
    }

    const message = data?.message;
    const content = extractText(message);
    const type = detectType(message);
    const externalMessageId = readString(key?.id);

    const persisted = await this.persistInboundMessage({
      tenantId: instance.tenantId,
      conversationId: conversation.id,
      content,
      type,
      externalMessageId,
      senderId: isGroup ? participant : null,
      senderName: isGroup ? pushName : null,
      metadata: {
        remoteJid,
        pushName,
        ...(participant ? { participantJid: participant } : {}),
        instanceName,
      },
    });

    if (!persisted) {
      return { accepted: true, ignored: 'duplicate_message' };
    }

    if (isMediaType(type)) {
      await this.queue.enqueue(JOB_NAMES.MEDIA_PROCESS, {
        tenantId: instance.tenantId,
        messageId: persisted.id,
      });
    }

    this.realtime.emitToConversation(instance.tenantId, conversation.id, 'message.created', {
      conversationId: conversation.id,
      messageId: persisted.id,
    });
    this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
      conversationId: conversation.id,
      status: conversation.status,
    });

    return {
      accepted: true,
      conversationId: conversation.id,
      messageId: persisted.id,
    };
  }

  private async recordEvent(input: {
    tenantId: string;
    externalEventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          tenantId: input.tenantId,
          provider: 'evolution',
          externalEventId: input.externalEventId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
      return false;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return true;
      }
      throw error;
    }
  }

  private async findOrCreateConversation(
    tenantId: string,
    whatsappInstanceId: string,
    externalContactId: string,
    contactId: string | null,
    isGroup: boolean,
  ) {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, whatsappInstanceId, externalContactId },
      select: { id: true, status: true, contactId: true, groupName: true, isGroup: true },
    });

    if (existing) {
      const data: Prisma.ConversationUncheckedUpdateInput = {};
      if (existing.status === ConversationStatus.CLOSED) {
        data.status = ConversationStatus.OPEN;
        data.closedAt = null;
      }
      if (!isGroup && !existing.contactId && contactId) {
        data.contactId = contactId;
      }
      if (isGroup && !existing.isGroup) {
        data.isGroup = true;
      }

      if (Object.keys(data).length === 0) {
        return existing;
      }

      return this.prisma.conversation.update({
        where: { id: existing.id },
        data,
        select: { id: true, status: true, groupName: true },
      });
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        whatsappInstanceId,
        externalContactId,
        contactId,
        isGroup,
        status: ConversationStatus.OPEN,
      },
      select: { id: true, status: true, groupName: true },
    });
  }

  private async resolveContact(tenantId: string, phone: string | null, name: string | null) {
    if (!phone) {
      return null;
    }
    return this.contacts.findOrCreateByPhone({ tenantId, phone, name });
  }

  private async ensureGroupMetadata(
    conversation: { id: string; groupName: string | null },
    instance: ResolvedInstance,
    groupJid: string,
  ): Promise<void> {
    if (conversation.groupName) {
      return;
    }

    const info = await this.directory.resolveGroupInfo(instance.instanceName, groupJid);
    if (!info) {
      return;
    }

    const data: Prisma.ConversationUpdateInput = {};
    if (info.name) data.groupName = info.name;
    if (info.avatarUrl) data.avatarUrl = info.avatarUrl;
    if (Object.keys(data).length === 0) {
      return;
    }

    await this.prisma.conversation.update({ where: { id: conversation.id }, data });
    this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
      conversationId: conversation.id,
    });
  }

  private async handleGroupUpsert(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const groups = toArray(payload.data).filter(isRecord);

    for (const group of groups) {
      const groupJid = readString(group.id) ?? readString(group.groupJid);
      if (!groupJid) {
        continue;
      }

      const conversation = await this.prisma.conversation.findFirst({
        where: {
          tenantId: instance.tenantId,
          whatsappInstanceId: instance.id,
          externalContactId: groupJid,
        },
        select: { id: true },
      });
      if (!conversation) {
        continue;
      }

      const subject = readString(group.subject) ?? readString(group.name);
      const pictureUrl =
        readString(group.pictureUrl) ??
        readString(group.profilePictureUrl) ??
        readString(group.avatar);

      const data: Prisma.ConversationUpdateInput = { isGroup: true };
      if (subject) data.groupName = subject;
      if (pictureUrl) data.avatarUrl = pictureUrl;

      await this.prisma.conversation.update({ where: { id: conversation.id }, data });
      this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
        conversationId: conversation.id,
      });
    }
  }

  private async persistInboundMessage(input: {
    tenantId: string;
    conversationId: string;
    content: string | null;
    type: MessageType;
    externalMessageId: string | null;
    senderId: string | null;
    senderName: string | null;
    metadata: Record<string, unknown>;
  }) {
    try {
      const message = await this.prisma.message.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          direction: 'INBOUND',
          type: input.type,
          content: input.content,
          externalMessageId: input.externalMessageId,
          status: 'RECEIVED',
          senderId: input.senderId,
          senderName: input.senderName,
          metadata: input.metadata as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      await this.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });

      return message;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }
}

function computeEventId(
  payload: Record<string, unknown>,
  eventType: string,
  instanceName: string,
): string {
  const data = isRecord(payload.data) ? payload.data : null;
  const key = data && isRecord(data.key) ? data.key : null;
  const messageId = readString(key?.id);
  if (messageId) {
    return `${instanceName}:${eventType}:${messageId}`;
  }

  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
  return `${instanceName}:${eventType}:${hash}`;
}

function readInstanceName(payload: Record<string, unknown>): string | null {
  const direct = readString(payload.instance) ?? readString(payload.instanceName);
  if (direct) {
    return direct;
  }
  const data = isRecord(payload.data) ? payload.data : null;
  return data ? readString(data.instance) : null;
}

function isGroupJid(remoteJid: string): boolean {
  return remoteJid.endsWith('@g.us');
}

function extractPhone(remoteJid: string): string | null {
  const [number] = remoteJid.split('@');
  const digits = number.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function extractText(message: unknown): string | null {
  if (!isRecord(message)) {
    return null;
  }
  const conversation = message.conversation;
  if (typeof conversation === 'string' && conversation.trim().length > 0) {
    return conversation;
  }
  const extended = isRecord(message.extendedTextMessage) ? message.extendedTextMessage : null;
  if (extended && typeof extended.text === 'string') {
    return extended.text;
  }
  const image = isRecord(message.imageMessage) ? message.imageMessage : null;
  if (image && typeof image.caption === 'string') {
    return image.caption;
  }
  const video = isRecord(message.videoMessage) ? message.videoMessage : null;
  if (video && typeof video.caption === 'string') {
    return video.caption;
  }
  return null;
}

function detectType(message: unknown): MessageType {
  if (!isRecord(message)) {
    return MessageType.UNKNOWN;
  }
  if (message.conversation !== undefined || message.extendedTextMessage !== undefined) {
    return MessageType.TEXT;
  }
  if (message.imageMessage !== undefined) return MessageType.IMAGE;
  if (message.audioMessage !== undefined) return MessageType.AUDIO;
  if (message.videoMessage !== undefined) return MessageType.VIDEO;
  if (message.documentMessage !== undefined) return MessageType.DOCUMENT;
  if (message.stickerMessage !== undefined) return MessageType.STICKER;
  if (message.locationMessage !== undefined) return MessageType.LOCATION;
  if (message.contactMessage !== undefined) return MessageType.CONTACT;
  return MessageType.UNKNOWN;
}

function isMediaType(type: MessageType): boolean {
  return (
    type === MessageType.IMAGE ||
    type === MessageType.AUDIO ||
    type === MessageType.VIDEO ||
    type === MessageType.DOCUMENT ||
    type === MessageType.STICKER
  );
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
