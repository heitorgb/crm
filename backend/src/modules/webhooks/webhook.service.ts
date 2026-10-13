import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { isGroupJid, phoneFromJid } from '../../common/whatsapp/jid.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { MessagesService, type QuotedMessageInfo } from '../conversations/messages.service.js';
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
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async ingestEvolution(payload: unknown): Promise<WebhookIngestResult> {
    try {
      return await this.processEvolution(payload);
    } catch (error) {
      this.logger.error(
        `Failed to process webhook event: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { accepted: false, ignored: 'processing_error' };
    }
  }

  private async processEvolution(payload: unknown): Promise<WebhookIngestResult> {
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

    if (eventType === 'presence.update') {
      await this.handlePresence(instance, payload);
      return { accepted: true };
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

    if (eventType === 'messages.update') {
      await this.handleMessageUpdate(instance, payload);
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

    const rawMessage = data?.message;
    const { message, viewOnce } = unwrapViewOnce(rawMessage);
    const reaction = readReaction(message);
    if (reaction && !reaction.emoji) {
      return { accepted: true, ignored: 'reaction_removed' };
    }

    const isGroup = isGroupJid(remoteJid);
    const participant = readString(key?.participant);
    const participantAlt = readString(key?.participantAlt);
    const remoteJidAlt = readString(key?.remoteJidAlt);
    const pushName = readString(data?.pushName);

    const contact = isGroup
      ? null
      : await this.resolveContact(
          instance.tenantId,
          resolveContactPhone(remoteJid, participantAlt, remoteJidAlt),
          pushName,
        );

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

    const content = reaction ? reaction.emoji : extractText(message);
    const type = reaction ? MessageType.REACTION : detectType(message);
    const externalMessageId = readString(key?.id);
    const quoted = await this.resolveInboundQuoted(instance.tenantId, message);
    const contacts = extractContacts(message);

    const senderId = reaction
      ? (participant ?? participantAlt ?? (isGroup ? null : remoteJid))
      : isGroup
        ? participant
        : null;

    const persisted = await this.persistInboundMessage({
      tenantId: instance.tenantId,
      conversationId: conversation.id,
      content,
      type,
      externalMessageId,
      senderId,
      senderName: isGroup || reaction ? pushName : null,
      metadata: {
        remoteJid,
        pushName,
        ...(participant ? { participantJid: participant } : {}),
        ...(viewOnce ? { viewOnce: true } : {}),
        ...(reaction
          ? {
              reaction: {
                targetMessageId: reaction.targetMessageId,
                targetFromMe: reaction.targetFromMe,
              },
            }
          : {}),
        ...(quoted ? { quoted } : {}),
        ...(contacts ? { contacts } : {}),
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
      direction: 'INBOUND',
    });
    this.realtime.emitToTenant(instance.tenantId, 'message.created', {
      conversationId: conversation.id,
      messageId: persisted.id,
      direction: 'INBOUND',
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

  private async handlePresence(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = isRecord(payload.data) ? payload.data : null;
    const remoteJid = readString(data?.id);
    const presences = data && isRecord(data.presences) ? data.presences : null;
    if (!remoteJid || !presences) return;

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: instance.tenantId,
        whatsappInstanceId: instance.id,
        externalContactId: remoteJid,
      },
      select: { id: true },
    });
    if (!conversation) return;

    for (const [participantId, presence] of Object.entries(presences)) {
      const state = isRecord(presence) ? readString(presence.lastKnownPresence) : null;
      if (
        !state ||
        !['composing', 'recording', 'paused', 'available', 'unavailable'].includes(state)
      )
        continue;
      this.realtime.emitToTenant(instance.tenantId, 'conversation.presence', {
        conversationId: conversation.id,
        participantId,
        state,
      });
    }
  }

  private async handleMessageUpdate(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const updates = toArray(payload.data).filter(isRecord);

    for (const update of updates) {
      const externalMessageId = readString(update.keyId);
      const status = mapEvolutionStatus(readString(update.status));
      if (!externalMessageId || !status) {
        continue;
      }

      const updated = await this.messages.updateOutboundStatusByExternalId({
        tenantId: instance.tenantId,
        externalMessageId,
        status,
      });
      if (!updated) {
        continue;
      }

      this.realtime.emitToConversation(
        instance.tenantId,
        updated.conversationId,
        'message.updated',
        {
          conversationId: updated.conversationId,
          messageId: updated.messageId,
          status: updated.status,
        },
      );
      this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
        conversationId: updated.conversationId,
      });
    }
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
        // A new inbound message returns an archived conversation to the inbox.
        data: { lastMessageAt: new Date(), isArchived: false },
      });

      return message;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /** Extracts the quoted message context of a reply, enriching it from the local history. */
  private async resolveInboundQuoted(
    tenantId: string,
    message: unknown,
  ): Promise<QuotedMessageInfo | null> {
    const contextInfo = findContextInfo(message);
    if (!contextInfo) {
      return null;
    }

    const externalId = readString(contextInfo.stanzaId);
    const authorJid = readString(contextInfo.participant);
    const quotedRaw = contextInfo.quotedMessage;
    let content = extractText(quotedRaw);
    let type = detectType(quotedRaw);
    let authorName: string | null = null;
    let fromMe = false;
    let messageId: string | null = null;

    if (externalId) {
      const local = await this.prisma.message.findFirst({
        where: { tenantId, externalMessageId: externalId },
        select: { id: true, direction: true, senderName: true, content: true, type: true },
      });
      if (local) {
        messageId = local.id;
        fromMe = local.direction === MessageDirection.OUTBOUND;
        authorName = local.senderName;
        content = local.content ?? content;
        type = local.type;
      }
    }

    return { messageId, externalId, authorName, authorJid, fromMe, content, type };
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

  const updateId = data ? readString(data.keyId) : null;
  if (updateId) {
    const status = readString(data?.status);
    return `${instanceName}:${eventType}:${updateId}${status ? `:${status}` : ''}`;
  }

  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
  return `${instanceName}:${eventType}:${hash}`;
}

function mapEvolutionStatus(value: string | null): MessageStatus | null {
  switch (value) {
    case 'PENDING':
      return MessageStatus.PENDING;
    case 'SERVER_ACK':
      return MessageStatus.SENT;
    case 'DELIVERY_ACK':
      return MessageStatus.DELIVERED;
    case 'READ':
    case 'PLAYED':
      return MessageStatus.READ;
    case 'ERROR':
      return MessageStatus.FAILED;
    default:
      return null;
  }
}

export function readInstanceName(payload: Record<string, unknown>): string | null {
  const direct = readString(payload.instance) ?? readString(payload.instanceName);
  if (direct) {
    return direct;
  }
  const data = isRecord(payload.data) ? payload.data : null;
  return data ? readString(data.instance) : null;
}

const VIEW_ONCE_KEYS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];

function unwrapViewOnce(value: unknown): { message: unknown; viewOnce: boolean } {
  if (!isRecord(value)) {
    return { message: value, viewOnce: false };
  }
  for (const key of VIEW_ONCE_KEYS) {
    const wrapper = value[key];
    if (isRecord(wrapper) && isRecord(wrapper.message)) {
      return { message: wrapper.message, viewOnce: true };
    }
  }
  return { message: value, viewOnce: false };
}

interface ParsedReaction {
  emoji: string | null;
  targetMessageId: string | null;
  targetFromMe: boolean;
}

/**
 * Reads an Evolution `reactionMessage`. The reactor is identified by the outer
 * message key; this payload only carries the reacted message and the emoji.
 */
function readReaction(message: unknown): ParsedReaction | null {
  if (!isRecord(message)) {
    return null;
  }
  const reaction = isRecord(message.reactionMessage) ? message.reactionMessage : null;
  if (!reaction) {
    return null;
  }
  const key = isRecord(reaction.key) ? reaction.key : null;
  return {
    emoji: readString(reaction.text),
    targetMessageId: key ? readString(key.id) : null,
    targetFromMe: key?.fromMe === true,
  };
}

/**
 * Individual conversations may be addressed by a LID (`<id>@lid`) without a
 * dialable phone. Evolution also sends the phone in the alternative fields.
 */
function resolveContactPhone(
  remoteJid: string,
  participantAlt: string | null,
  remoteJidAlt: string | null,
): string | null {
  return (
    phoneFromJid(remoteJid) ??
    (participantAlt ? phoneFromJid(participantAlt) : null) ??
    (remoteJidAlt ? phoneFromJid(remoteJidAlt) : null)
  );
}

const CONTEXT_MESSAGE_PARTS = [
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'locationMessage',
  'contactMessage',
] as const;

function findContextInfo(message: unknown): Record<string, unknown> | null {
  if (!isRecord(message)) {
    return null;
  }
  for (const part of CONTEXT_MESSAGE_PARTS) {
    const node = message[part];
    if (isRecord(node) && isRecord(node.contextInfo)) {
      return node.contextInfo;
    }
  }
  return null;
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
  const contact = isRecord(message.contactMessage) ? message.contactMessage : null;
  if (contact && typeof contact.displayName === 'string' && contact.displayName.trim().length > 0) {
    return contact.displayName;
  }
  const contactsArray = isRecord(message.contactsArrayMessage)
    ? message.contactsArrayMessage
    : null;
  if (
    contactsArray &&
    typeof contactsArray.displayName === 'string' &&
    contactsArray.displayName.trim().length > 0
  ) {
    return contactsArray.displayName;
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
  if (message.contactMessage !== undefined || message.contactsArrayMessage !== undefined)
    return MessageType.CONTACT;
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

interface ParsedContact {
  name: string | null;
  phone: string | null;
}

function extractContacts(message: unknown): ParsedContact[] | null {
  if (!isRecord(message)) {
    return null;
  }

  const single = isRecord(message.contactMessage) ? message.contactMessage : null;
  if (single) {
    const contact = parseContact(single);
    return contact ? [contact] : null;
  }

  const array = isRecord(message.contactsArrayMessage) ? message.contactsArrayMessage : null;
  if (array && Array.isArray(array.contacts)) {
    const contacts = array.contacts
      .filter(isRecord)
      .map(parseContact)
      .filter((contact): contact is ParsedContact => contact !== null);
    return contacts.length > 0 ? contacts : null;
  }

  return null;
}

function parseContact(value: Record<string, unknown>): ParsedContact | null {
  const displayName = readString(value.displayName);
  const vcard = readString(value.vcard);
  const parsed = vcard ? parseVcard(vcard) : { name: null, phone: null };
  const name = displayName ?? parsed.name;

  if (!name && !parsed.phone) {
    return null;
  }

  return { name, phone: parsed.phone };
}

function parseVcard(vcard: string): { name: string | null; phone: string | null } {
  let name: string | null = null;
  let phone: string | null = null;

  for (const rawLine of vcard.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!name && /^FN[:;]/i.test(line)) {
      name = readString(line.slice(line.indexOf(':') + 1).trim());
    } else if (!phone && /^TEL[:;]/i.test(line)) {
      const waid = /waid=(\d+)/i.exec(line);
      phone = waid ? waid[1] : readString(line.slice(line.indexOf(':') + 1).trim());
    }
  }

  return { name, phone };
}
