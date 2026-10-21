import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  MessageStatus,
  MessageType,
  Prisma,
  WhatsAppInstanceStatus,
} from '@prisma/client';
import { hasHttpUrl, type LinkPreviewMetadata } from '../../common/link-preview/link-preview.js';
import { pickDestination, type DestinationInput } from '../../common/whatsapp/destination.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { MediaProcessingService } from '../../infrastructure/media/media-processing.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import {
  EvolutionClient,
  EvolutionRequestError,
  EvolutionUnavailableError,
  type EvolutionMediaType,
  type EvolutionQuotedMessage,
  type EvolutionSendResult,
} from '../whatsapp/evolution/evolution.client.js';
import {
  ConversationNotFoundError,
  MessageNotEditableError,
  WhatsAppInstanceNotConnectedError,
} from './conversations.errors.js';
import { MessagesService, type MessageView, type QuotedMessageInfo } from './messages.service.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';

type ConversationWithInstance = Prisma.ConversationGetPayload<{
  include: { instance: true; contact: { select: { phone: true } } };
}>;

function destinationInput(conversation: ConversationWithInstance): DestinationInput {
  return {
    externalContactId: conversation.externalContactId,
    externalLid: conversation.externalLid,
    contactPhone: conversation.contact?.phone ?? null,
  };
}

export interface DeliverMediaInput {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  caption?: string | null;
}

export interface OutboundAuthor {
  senderId: string | null;
  senderName: string | null;
  showAgentName: boolean;
}

export interface DeliverTextOptions {
  /** Whether Evolution should render a link preview (false suppresses it). */
  linkPreview?: boolean;
  preview?: LinkPreviewMetadata | null;
}

export interface RecordOutboundMessageInput {
  tenantId: string;
  whatsappInstanceId: string;
  externalContactId: string;
  contactId: string | null;
  text: string;
  externalMessageId: string | null;
  metadata?: Record<string, unknown>;
  isGroup?: boolean;
  groupName?: string | null;
  groupAvatarUrl?: string | null;
}

export interface RecordedOutboundMessage {
  messageId: string;
  conversationId: string;
}

export interface SendExternalImageInput {
  tenantId: string;
  whatsappInstanceId: string;
  externalContactId: string;
  contactId: string | null;
  caption: string;
  buffer: Buffer;
  fileName: string;
  metadata?: Record<string, unknown>;
  isGroup?: boolean;
  groupName?: string | null;
  groupAvatarUrl?: string | null;
}

export interface SentExternalImage {
  messageId: string;
  conversationId: string;
  externalMessageId: string | null;
}

export interface SendStoredMediaInput {
  tenantId: string;
  conversationId: string;
  storageKey: string;
  thumbnailKey?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SentStoredMedia {
  messageId: string;
  conversationId: string;
  externalMessageId: string | null;
  status: MessageStatus;
  errorCode?: string;
}

export interface SentStoredText {
  messageId: string;
  conversationId: string;
  externalMessageId: string | null;
  status: MessageStatus;
  errorCode?: string;
}

@Injectable()
export class ConversationProcessingService implements OnModuleInit {
  private readonly logger = new Logger(ConversationProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly evolution: EvolutionClient,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    private readonly media: MediaProcessingService,
    private readonly config: ConfigService<Env, true>,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.WHATSAPP_SEND, (payload) => this.retrySend(payload));
    this.queue.registerProcessor(JOB_NAMES.MEDIA_PROCESS, (payload) => this.processMedia(payload));
  }

  /** Delivers a text message written by an agent in the chat. */
  async deliverText(
    tenantId: string,
    conversationId: string,
    text: string,
    author: OutboundAuthor,
    quoted: QuotedMessageInfo | null = null,
    options: DeliverTextOptions = {},
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true, contact: { select: { phone: true } } },
    });
    if (!conversation) {
      return;
    }

    if (conversation.instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WhatsAppInstanceNotConnectedError();
    }

    const outbound = await this.messages.persistOutbound({
      tenantId,
      conversationId: conversation.id,
      content: text,
      senderId: author.senderId,
      senderName: author.senderName,
      metadata: buildMetadata(author, quoted, options),
    });

    const outgoingText = buildOutboundText(text, author) ?? text;

    await this.dispatch(
      tenantId,
      conversation,
      outbound.id,
      MessageType.TEXT,
      outgoingText,
      null,
      outgoingText,
      buildEvolutionQuoted(conversation.externalContactId, quoted),
      options.linkPreview ?? (hasHttpUrl(outgoingText) ? true : undefined),
    );
  }

  /** Optimizes, stores and sends an uploaded media file. */
  async deliverMedia(
    tenantId: string,
    conversationId: string,
    input: DeliverMediaInput,
    author: OutboundAuthor,
    quoted: QuotedMessageInfo | null = null,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true, contact: { select: { phone: true } } },
    });
    if (!conversation) {
      return;
    }

    if (conversation.instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WhatsAppInstanceNotConnectedError();
    }

    const isImage = await this.media.isImage(input.buffer);
    const type = isImage ? MessageType.IMAGE : messageTypeForMime(input.mimeType);
    const caption = type === MessageType.AUDIO ? null : input.caption?.trim() || null;

    const stored = isImage
      ? await this.storeImage(tenantId, 'outbound', input.buffer, input.fileName)
      : await this.storeFile(tenantId, 'outbound', input.buffer, input.fileName, input.mimeType);

    const outbound = await this.messages.persistOutbound({
      tenantId,
      conversationId: conversation.id,
      content: caption,
      type,
      senderId: author.senderId,
      senderName: author.senderName,
      metadata: buildMetadata(author, quoted),
    });

    await this.messages.createAttachment({
      tenantId,
      messageId: outbound.id,
      storageKey: stored.storageKey,
      thumbnailKey: stored.thumbnailKey,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      size: stored.size,
      width: stored.width,
      height: stored.height,
    });

    await this.dispatch(
      tenantId,
      conversation,
      outbound.id,
      type,
      stored.base64,
      { mimeType: stored.mimeType, fileName: stored.fileName },
      caption ? buildOutboundText(caption, author) : caption,
      buildEvolutionQuoted(conversation.externalContactId, quoted),
      undefined,
    );
  }

  /**
   * Records an outbound message that was already accepted by the provider
   * outside the human chat flow (e.g. a billing reminder). It resolves (or
   * creates) the conversation for the instance/contact, persists the message
   * with the provider id, touches the conversation and publishes the realtime
   * events, so the send also shows up in Atendimento → Conversas.
   *
   * Idempotent with the webhook: messages are keyed by `(tenantId,
   * externalMessageId)`, so a later `messages.upsert` for the same provider id
   * is reconciled into the existing row instead of creating a duplicate. When
   * the provider id is unavailable the message is still recorded, but the
   * webhook can no longer be correlated (Evolution limitation).
   */
  async recordOutboundMessage(
    input: RecordOutboundMessageInput,
  ): Promise<RecordedOutboundMessage | null> {
    const conversation = await this.findOrCreateConversation(
      input.tenantId,
      input.whatsappInstanceId,
      input.externalContactId,
      input.contactId,
      input.isGroup ?? input.externalContactId.endsWith('@g.us'),
      input.groupName ?? null,
      input.groupAvatarUrl ?? null,
    );

    if (input.externalMessageId) {
      const existing = await this.prisma.message.findFirst({
        where: { tenantId: input.tenantId, externalMessageId: input.externalMessageId },
        select: { id: true, conversationId: true },
      });
      if (existing) {
        return { messageId: existing.id, conversationId: existing.conversationId };
      }
    }

    let message: MessageView;
    try {
      message = await this.messages.persistOutbound({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        content: input.text,
        externalMessageId: input.externalMessageId,
        status: MessageStatus.SENT,
        metadata: input.metadata,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = input.externalMessageId
          ? await this.prisma.message.findFirst({
              where: {
                tenantId: input.tenantId,
                externalMessageId: input.externalMessageId,
              },
              select: { id: true, conversationId: true },
            })
          : null;
        return existing
          ? { messageId: existing.id, conversationId: existing.conversationId }
          : null;
      }
      throw error;
    }

    const occurredAt = new Date();
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: occurredAt },
    });

    this.realtime.emitToConversation(input.tenantId, conversation.id, 'message.created', {
      conversationId: conversation.id,
      messageId: message.id,
      direction: 'OUTBOUND',
    });
    this.realtime.emitToTenant(input.tenantId, 'message.created', {
      conversationId: conversation.id,
      messageId: message.id,
      direction: 'OUTBOUND',
    });
    this.realtime.emitToTenant(input.tenantId, 'conversation.updated', {
      conversationId: conversation.id,
    });

    return { messageId: message.id, conversationId: conversation.id };
  }

  /**
   * Sends an image to an external destination (used by integration webhooks)
   * and records the message as an IMAGE with caption only after the provider
   * confirms the send. The image is optimized/stored with the same media
   * pipeline used by the attendance flow.
   */
  async sendExternalImage(input: SendExternalImageInput): Promise<SentExternalImage> {
    const conversation = await this.findOrCreateConversation(
      input.tenantId,
      input.whatsappInstanceId,
      input.externalContactId,
      input.contactId,
      input.isGroup ?? input.externalContactId.endsWith('@g.us'),
      input.groupName ?? null,
      input.groupAvatarUrl ?? null,
    );

    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { id: input.whatsappInstanceId, tenantId: input.tenantId },
      select: { instanceName: true, status: true },
    });
    if (!instance) {
      throw new WhatsAppInstanceNotConnectedError();
    }
    if (instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WhatsAppInstanceNotConnectedError();
    }

    const stored = await this.storeImage(
      input.tenantId,
      conversation.id,
      input.buffer,
      input.fileName,
    );

    let sent: Awaited<ReturnType<EvolutionClient['sendMedia']>>;
    try {
      sent = await this.evolution.sendMedia(instance.instanceName, {
        number: input.externalContactId,
        mediatype: 'image',
        media: stored.base64,
        fileName: stored.fileName,
        mimetype: stored.mimeType,
        ...(input.caption ? { caption: input.caption } : {}),
      });
    } catch (error) {
      await Promise.allSettled([
        this.storage.delete(stored.storageKey),
        ...(stored.thumbnailKey ? [this.storage.delete(stored.thumbnailKey)] : []),
      ]);
      throw error;
    }

    const externalMessageId = sent.externalMessageId ?? null;
    let messageId: string;
    let conversationId = conversation.id;

    try {
      const message = await this.messages.persistOutbound({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        content: input.caption,
        type: MessageType.IMAGE,
        externalMessageId,
        status: MessageStatus.SENT,
        metadata: {
          ...(input.metadata ?? {}),
          ...(externalMessageId ? { externalMessageId } : {}),
        },
      });
      messageId = message.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = externalMessageId
          ? await this.prisma.message.findFirst({
              where: { tenantId: input.tenantId, externalMessageId },
              select: { id: true, conversationId: true },
            })
          : null;
        if (!existing) {
          throw error;
        }
        messageId = existing.id;
        conversationId = existing.conversationId;
      } else {
        throw error;
      }
    }

    const attachmentCount = await this.prisma.messageAttachment.count({ where: { messageId } });
    if (attachmentCount === 0) {
      await this.messages.createAttachment({
        tenantId: input.tenantId,
        messageId,
        storageKey: stored.storageKey,
        thumbnailKey: stored.thumbnailKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        size: stored.size,
        width: stored.width,
        height: stored.height,
      });
    }

    await this.touchConversation(conversationId);
    this.realtime.emitToConversation(input.tenantId, conversationId, 'message.created', {
      conversationId,
      messageId,
      direction: 'OUTBOUND',
    });
    this.realtime.emitToTenant(input.tenantId, 'message.created', {
      conversationId,
      messageId,
      direction: 'OUTBOUND',
    });
    this.realtime.emitToTenant(input.tenantId, 'conversation.updated', {
      conversationId,
    });

    return { messageId, conversationId, externalMessageId };
  }

  /**
   * Sends a media file that is already optimized/stored (bulk camera batches and
   * scheduled messages). The message and attachment are persisted before the
   * provider call, so a failure remains visible in the conversation as FAILED.
   * The result is returned per recipient instead of thrown, allowing the caller
   * to log failures and continue with the next recipient.
   */
  async sendStoredMediaToConversation(input: SendStoredMediaInput): Promise<SentStoredMedia> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId, deletedAt: null },
      include: { instance: true, contact: { select: { phone: true } } },
    });
    if (!conversation) {
      throw new ConversationNotFoundError();
    }
    if (conversation.instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WhatsAppInstanceNotConnectedError();
    }

    const type = messageTypeForMime(input.mimeType);
    const caption = input.caption?.trim() || null;
    const outbound = await this.messages.persistOutbound({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      content: caption,
      type,
      metadata: input.metadata,
    });

    await this.messages.createAttachment({
      tenantId: input.tenantId,
      messageId: outbound.id,
      storageKey: input.storageKey,
      thumbnailKey: input.thumbnailKey ?? null,
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.size,
      width: input.width ?? null,
      height: input.height ?? null,
    });

    const destination = pickDestination(
      destinationInput(conversation),
      conversation.preferredAddress,
    );
    const instanceName = conversation.instance.instanceName;
    const endpoint = 'POST /message/sendMedia';

    try {
      if (!this.evolution.configured || !destination) {
        throw new EvolutionUnavailableError('Evolution API is not configured for this instance');
      }

      const buffer = await this.storage.get(input.storageKey);
      const sent = await this.evolution.sendMedia(instanceName, {
        number: destination.address,
        mediatype: type === MessageType.IMAGE ? 'image' : 'document',
        media: buffer.toString('base64'),
        fileName: input.fileName,
        mimetype: input.mimeType,
        ...(caption ? { caption } : {}),
      });

      await this.messages.markOutboundStatus(
        outbound.id,
        MessageStatus.SENT,
        sent.externalMessageId,
        {
          destinationType: destination.type,
        },
      );
      this.logger.debug(
        `whatsapp.send.succeeded ${JSON.stringify(
          this.sendLogContext({
            phase: 'initial',
            messageId: outbound.id,
            tenantId: input.tenantId,
            instanceName,
            endpoint,
            durationMs: 0,
            externalMessageId: sent.externalMessageId ?? null,
          }),
        )}`,
      );

      await this.touchConversation(conversation.id);
      this.emitMessageEvents(input.tenantId, conversation.id, outbound.id);

      return {
        messageId: outbound.id,
        conversationId: conversation.id,
        externalMessageId: sent.externalMessageId ?? null,
        status: MessageStatus.SENT,
      };
    } catch (error) {
      const failure = classifySendFailure(error);
      await this.messages.markOutboundFailed(outbound.id, failure.code);

      await this.touchConversation(conversation.id);
      this.emitMessageEvents(input.tenantId, conversation.id, outbound.id);

      return {
        messageId: outbound.id,
        conversationId: conversation.id,
        externalMessageId: null,
        status: MessageStatus.FAILED,
        errorCode: failure.code,
      };
    }
  }

  async sendStoredTextToConversation(input: {
    tenantId: string;
    conversationId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): Promise<SentStoredText> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId, deletedAt: null },
      include: { instance: true, contact: { select: { phone: true } } },
    });
    if (!conversation) {
      throw new ConversationNotFoundError();
    }
    if (conversation.instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WhatsAppInstanceNotConnectedError();
    }

    const outbound = await this.messages.persistOutbound({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      content: input.text,
      type: MessageType.TEXT,
      metadata: input.metadata,
    });

    const destination = pickDestination(
      destinationInput(conversation),
      conversation.preferredAddress,
    );
    const instanceName = conversation.instance.instanceName;
    const endpoint = 'POST /message/sendText';
    const startedAt = Date.now();

    try {
      if (!this.evolution.configured || !destination) {
        throw new EvolutionUnavailableError('Evolution API is not configured for this instance');
      }

      const sent = await this.evolution.sendText(
        instanceName,
        destination.address,
        input.text,
        undefined,
        hasHttpUrl(input.text) ? { linkPreview: true } : undefined,
      );

      await this.messages.markOutboundStatus(
        outbound.id,
        MessageStatus.SENT,
        sent.externalMessageId,
        {
          destinationType: destination.type,
        },
      );
      this.logger.debug(
        `whatsapp.send.succeeded ${JSON.stringify(
          this.sendLogContext({
            phase: 'initial',
            messageId: outbound.id,
            tenantId: input.tenantId,
            instanceName,
            endpoint,
            durationMs: Date.now() - startedAt,
            externalMessageId: sent.externalMessageId ?? null,
          }),
        )}`,
      );

      await this.touchConversation(conversation.id);
      this.emitMessageEvents(input.tenantId, conversation.id, outbound.id);

      return {
        messageId: outbound.id,
        conversationId: conversation.id,
        externalMessageId: sent.externalMessageId ?? null,
        status: MessageStatus.SENT,
      };
    } catch (error) {
      const failure = classifySendFailure(error);
      await this.messages.markOutboundFailed(outbound.id, failure.code);

      await this.touchConversation(conversation.id);
      this.emitMessageEvents(input.tenantId, conversation.id, outbound.id);

      return {
        messageId: outbound.id,
        conversationId: conversation.id,
        externalMessageId: null,
        status: MessageStatus.FAILED,
        errorCode: failure.code,
      };
    }
  }

  private emitMessageEvents(tenantId: string, conversationId: string, messageId: string): void {
    this.realtime.emitToConversation(tenantId, conversationId, 'message.created', {
      conversationId,
      messageId,
      direction: 'OUTBOUND',
    });
    this.realtime.emitToTenant(tenantId, 'message.created', {
      conversationId,
      messageId,
      direction: 'OUTBOUND',
    });
    this.realtime.emitToTenant(tenantId, 'conversation.updated', { conversationId });
  }

  /** Edits a message already delivered to WhatsApp, in place. */
  async editText(
    tenantId: string,
    conversation: ConversationWithInstance,
    target: { id: string; externalMessageId: string },
    content: string,
  ): Promise<void> {
    const remoteJid = conversation.externalContactId;
    const destination = pickDestination(
      destinationInput(conversation),
      conversation.preferredAddress,
    );
    if (conversation.instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WhatsAppInstanceNotConnectedError();
    }
    if (!this.evolution.configured || !remoteJid || !destination) {
      throw new EvolutionUnavailableError('Evolution API is not configured for this instance');
    }

    try {
      await this.evolution.updateMessage(conversation.instance.instanceName, {
        number: destination.address,
        key: { id: target.externalMessageId, remoteJid, fromMe: true },
        text: content,
      });
    } catch (error) {
      if (error instanceof EvolutionRequestError && error.httpStatus) {
        if (error.httpStatus === 404) {
          throw new MessageNotEditableError(
            'O WhatsApp não encontrou a mensagem original para editar.',
          );
        }
        if (error.httpStatus === 400 || error.httpStatus === 422) {
          throw new MessageNotEditableError('O WhatsApp recusou a edição desta mensagem.');
        }
      }
      throw error;
    }

    const updated = await this.messages.applyEditById({
      tenantId,
      messageId: target.id,
      content,
    });
    if (!updated) {
      return;
    }

    this.realtime.emitToConversation(tenantId, conversation.id, 'message.updated', {
      conversationId: conversation.id,
      messageId: updated.messageId,
    });
    this.realtime.emitToTenant(tenantId, 'conversation.updated', {
      conversationId: conversation.id,
    });
  }

  async processMedia(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const messageId = asString(payload.messageId);
    if (!tenantId || !messageId) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const message = await this.prisma.message.findFirst({
        where: { id: messageId, tenantId },
        select: {
          id: true,
          type: true,
          direction: true,
          metadata: true,
        },
      });
      if (!message) {
        return;
      }

      await this.ensureMediaStored(tenantId, messageId);

      if (isTranscribableAudio(message)) {
        try {
          await this.queue.enqueue(
            JOB_NAMES.TRANSCRIPTION_PROCESS,
            { tenantId, messageId },
            { jobId: `transcription-${messageId}` },
          );
        } catch (error) {
          this.logger.warn(
            `Failed to enqueue transcription for message ${messageId}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    });
  }

  /**
   * Downloads an inbound/outbound media file from Evolution exactly once and
   * stores it with the regular attachment pipeline. It is reused by the media
   * job and by the transcription job when the attachment is not available yet.
   */
  async ensureMediaStored(
    tenantId: string,
    messageId: string,
  ): Promise<MediaStorageResult> {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId },
      include: { conversation: { include: { instance: true } } },
    });
    if (!message) {
      return 'missing';
    }

    const alreadyStored = await this.prisma.messageAttachment.count({ where: { messageId } });
    if (alreadyStored > 0) {
      return 'stored';
    }

    const conversation = message.conversation;
    const remoteJid = conversation.externalContactId;
    const externalId = message.externalMessageId;
    // Media the user sent from the phone/Web is stored too, so it can be
    // downloaded from the provider with the matching direction.
    const fromMe = message.direction === 'OUTBOUND';
    if (!externalId || !remoteJid) {
      await this.markMediaError(
        tenantId,
        conversation.id,
        messageId,
        message.metadata,
        'missing_media_key',
      );
      return 'missing_media_key';
    }

    let content;
    try {
      content = await this.evolution.getBase64FromMediaMessage(
        conversation.instance.instanceName,
        { id: externalId, remoteJid, fromMe },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to fetch media for message ${messageId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      await this.markMediaError(
        tenantId,
        conversation.id,
        messageId,
        message.metadata,
        'fetch_failed',
      );
      return 'fetch_failed';
    }

    const maxBytes = this.config.get('MEDIA_MAX_BYTES');
    if ((content.size ?? 0) > maxBytes) {
      await this.markMediaError(
        tenantId,
        conversation.id,
        messageId,
        message.metadata,
        'too_large',
      );
      return 'too_large';
    }
    if (content.base64.length > maxBytes * 2) {
      await this.markMediaError(
        tenantId,
        conversation.id,
        messageId,
        message.metadata,
        'too_large',
      );
      return 'too_large';
    }

    const buffer = decodeBase64(content.base64);
    if (!buffer || buffer.length === 0) {
      await this.markMediaError(tenantId, conversation.id, messageId, message.metadata, 'empty');
      return 'empty';
    }
    if (buffer.length > maxBytes) {
      await this.markMediaError(
        tenantId,
        conversation.id,
        messageId,
        message.metadata,
        'too_large',
      );
      return 'too_large';
    }

    const isSticker = message.type === MessageType.STICKER;
    const isImage = !isSticker && (await this.media.isImage(buffer));
    const stored = isImage
      ? await this.storeImage(tenantId, messageId, buffer, content.fileName ?? 'image.jpg')
      : await this.storeFile(
          tenantId,
          messageId,
          buffer,
          content.fileName ?? (isSticker ? 'sticker.webp' : 'file'),
          content.mimeType ?? (isSticker ? 'image/webp' : 'application/octet-stream'),
        );

    await this.messages.createAttachment({
      tenantId,
      messageId,
      storageKey: stored.storageKey,
      thumbnailKey: stored.thumbnailKey,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      size: stored.size,
      width: stored.width,
      height: stored.height,
    });

    if (!message.content && content.caption) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { content: content.caption },
      });
    }

    this.realtime.emitToTenant(tenantId, 'conversation.updated', {
      conversationId: conversation.id,
      messageId,
    });

    return 'stored';
  }

  async retrySend(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const messageId = asString(payload.messageId);
    const fallback = payload.fallback === true;
    if (!tenantId || !messageId) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const message = await this.prisma.message.findFirst({
        where: { id: messageId, tenantId },
        include: {
          conversation: { include: { instance: true, contact: { select: { phone: true } } } },
          attachments: true,
        },
      });

      // A normal retry only resends a message the provider never accepted. A
      // fallback resend (triggered by a provider ERROR) resends a message that
      // was accepted but failed, now to the alternate address, exactly once.
      if (!message || !isSendable(message, fallback)) {
        return;
      }

      const conversation = message.conversation;
      if (conversation.instance.status !== WhatsAppInstanceStatus.CONNECTED) {
        this.logger.warn(
          `whatsapp.send.skipped ${JSON.stringify({
            phase: fallback ? 'fallback' : 'retry',
            messageId,
            tenantId,
            instance: conversation.instance.instanceName,
            reason: 'instance_not_connected',
          })}`,
        );
        return;
      }

      const instanceName = conversation.instance.instanceName;
      const destination = pickDestination(
        destinationInput(conversation),
        conversation.preferredAddress,
      );
      const showAgentName = isRecord(message.metadata) && message.metadata.showAgentName === true;
      const suppressLinkPreview =
        isRecord(message.metadata) && message.metadata.suppressLinkPreview === true;
      const outgoingText =
        buildOutboundText(message.content, {
          senderName: message.senderName,
          showAgentName,
        }) ?? '';
      const evolutionQuoted = buildEvolutionQuoted(
        conversation.externalContactId,
        readQuotedFromMetadata(message.metadata),
      );
      const attachment = message.attachments[0];
      const endpoint = attachment
        ? message.type === MessageType.AUDIO
          ? 'POST /message/sendWhatsAppAudio'
          : 'POST /message/sendMedia'
        : 'POST /message/sendText';
      const startedAt = Date.now();

      try {
        if (!this.evolution.configured || !destination) {
          throw new EvolutionUnavailableError('Evolution API is not configured for this instance');
        }

        let sent: EvolutionSendResult;
        if (attachment && message.type === MessageType.AUDIO) {
          sent = await this.evolution.sendWhatsAppAudio(instanceName, {
            number: destination.address,
            audio: (await this.storage.get(attachment.storageKey)).toString('base64'),
          });
        } else if (attachment) {
          sent = await this.evolution.sendMedia(instanceName, {
            number: destination.address,
            mediatype: mediaTypeForMessage(message.type),
            media: (await this.storage.get(attachment.storageKey)).toString('base64'),
            fileName: attachment.fileName,
            mimetype: attachment.mimeType,
            ...(message.content ? { caption: outgoingText } : {}),
            ...(evolutionQuoted ? { quoted: evolutionQuoted } : {}),
          });
        } else {
          sent = await this.sendText(
            instanceName,
            destination.address,
            outgoingText,
            evolutionQuoted ?? undefined,
            hasHttpUrl(outgoingText) ? !suppressLinkPreview : undefined,
          );
        }

        await this.messages.markOutboundStatus(
          messageId,
          MessageStatus.SENT,
          sent.externalMessageId,
          {
            destinationType: destination.type,
          },
        );
        this.logger.debug(
          `whatsapp.send.succeeded ${JSON.stringify(
            this.sendLogContext({
              phase: 'retry',
              messageId,
              tenantId,
              instanceName,
              endpoint,
              durationMs: Date.now() - startedAt,
              externalMessageId: sent.externalMessageId ?? null,
            }),
          )}`,
        );
      } catch (error) {
        const failure = classifySendFailure(error);
        await this.messages.markOutboundFailed(messageId, failure.code);
        this.logger.warn(
          `whatsapp.send.failed ${JSON.stringify(
            this.sendLogContext({
              phase: 'retry',
              messageId,
              tenantId,
              instanceName,
              endpoint,
              durationMs: Date.now() - startedAt,
              externalMessageId: null,
              error,
            }),
          )}`,
        );
        // A retryable provider error (definitive HTTP 429/5xx) lets BullMQ use
        // its bounded attempts. A network failure has an uncertain outcome, so
        // the message stays FAILED and is not blindly resent; the operator can
        // retry explicitly.
        if (failure.retryable) {
          throw error;
        }
      }
    });
  }

  private sendText(
    instanceName: string,
    destination: string,
    text: string,
    quoted: EvolutionQuotedMessage | undefined,
    linkPreview: boolean | undefined,
  ): Promise<EvolutionSendResult> {
    if (linkPreview === undefined) {
      return this.evolution.sendText(instanceName, destination, text, quoted);
    }
    return this.evolution.sendText(instanceName, destination, text, quoted, { linkPreview });
  }

  private async dispatch(
    tenantId: string,
    conversation: ConversationWithInstance,
    messageId: string,
    type: MessageType,
    mediaOrText: string,
    file: { mimeType: string; fileName: string } | null,
    caption: string | null,
    quoted: EvolutionQuotedMessage | null,
    linkPreview: boolean | undefined,
  ): Promise<void> {
    const destination = pickDestination(
      destinationInput(conversation),
      conversation.preferredAddress,
    );
    const instanceName = conversation.instance.instanceName;
    const endpoint = file
      ? type === MessageType.AUDIO
        ? 'POST /message/sendWhatsAppAudio'
        : 'POST /message/sendMedia'
      : 'POST /message/sendText';
    const startedAt = Date.now();

    try {
      if (!this.evolution.configured || !destination) {
        throw new EvolutionUnavailableError('Evolution API is not configured for this instance');
      }

      const sent =
        file && type === MessageType.AUDIO
          ? await this.evolution.sendWhatsAppAudio(instanceName, {
              number: destination.address,
              audio: mediaOrText,
            })
          : file
            ? await this.evolution.sendMedia(instanceName, {
                number: destination.address,
                mediatype: mediaTypeForMessage(type),
                media: mediaOrText,
                fileName: file.fileName,
                mimetype: file.mimeType,
                ...(caption ? { caption } : {}),
                ...(quoted ? { quoted } : {}),
              })
            : await this.sendText(
                instanceName,
                destination.address,
                mediaOrText,
                quoted ?? undefined,
                linkPreview,
              );

      await this.messages.markOutboundStatus(
        messageId,
        MessageStatus.SENT,
        sent.externalMessageId,
        {
          destinationType: destination.type,
        },
      );
      this.logger.debug(
        `whatsapp.send.succeeded ${JSON.stringify(
          this.sendLogContext({
            phase: 'initial',
            messageId,
            tenantId,
            instanceName,
            endpoint,
            durationMs: Date.now() - startedAt,
            externalMessageId: sent.externalMessageId ?? null,
          }),
        )}`,
      );
    } catch (error) {
      const failure = classifySendFailure(error);
      await this.messages.markOutboundFailed(messageId, failure.code);
      this.logger.warn(
        `whatsapp.send.failed ${JSON.stringify(
          this.sendLogContext({
            phase: 'initial',
            messageId,
            tenantId,
            instanceName,
            endpoint,
            durationMs: Date.now() - startedAt,
            externalMessageId: null,
            error,
          }),
        )}`,
      );

      // Only a definitive provider rejection (HTTP 429/5xx, request completed
      // but not accepted) is retried automatically. A network failure leaves the
      // acceptance uncertain, so it is not blindly replayed.
      if (failure.retryable) {
        try {
          await this.queue.enqueue(JOB_NAMES.WHATSAPP_SEND, { tenantId, messageId });
        } catch (enqueueError) {
          this.logger.warn(
            `whatsapp.send.enqueue_failed ${JSON.stringify({
              messageId,
              tenantId,
              instance: instanceName,
              error: enqueueError instanceof Error ? enqueueError.message : 'unknown',
            })}`,
          );
        }
      }
    }

    await this.touchConversation(conversation.id);
    this.realtime.emitToConversation(tenantId, conversation.id, 'message.created', {
      conversationId: conversation.id,
      messageId,
      direction: 'OUTBOUND',
    });
    this.realtime.emitToTenant(tenantId, 'message.created', {
      conversationId: conversation.id,
      messageId,
      direction: 'OUTBOUND',
    });
  }

  private sendLogContext(params: {
    phase: 'initial' | 'retry';
    messageId: string;
    tenantId: string;
    instanceName: string;
    endpoint: string;
    durationMs: number;
    externalMessageId: string | null;
    error?: unknown;
  }): Record<string, unknown> {
    return {
      phase: params.phase,
      messageId: params.messageId,
      tenantId: params.tenantId,
      instance: params.instanceName,
      endpoint: params.endpoint,
      durationMs: params.durationMs,
      externalMessageId: params.externalMessageId,
      ...(params.error !== undefined ? { error: sanitizeError(params.error) } : {}),
    };
  }

  private async storeImage(
    tenantId: string,
    scopeId: string,
    input: Buffer,
    fileName: string,
  ): Promise<StoredMedia> {
    const optimized = await this.media.optimizeImage(input);
    const thumbnail = await this.media.makeThumbnail(input);

    const baseKey = `tenant/${tenantId}/messages/${scopeId}/${randomUUID()}`;
    const storageKey = `${baseKey}.${optimized.extension}`;
    const thumbnailKey = `${baseKey}_thumb.${thumbnail.extension}`;

    await this.storage.put(storageKey, optimized.buffer);
    await this.storage.put(thumbnailKey, thumbnail.buffer);

    return {
      storageKey,
      thumbnailKey,
      fileName: ensureExtension(fileName, optimized.extension),
      mimeType: optimized.mimeType,
      size: optimized.size,
      width: optimized.width,
      height: optimized.height,
      base64: optimized.buffer.toString('base64'),
    };
  }

  private async storeFile(
    tenantId: string,
    scopeId: string,
    input: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<StoredMedia> {
    const extension = extensionForMime(mimeType);
    const storageKey = `tenant/${tenantId}/messages/${scopeId}/${randomUUID()}.${extension}`;
    await this.storage.put(storageKey, input);

    return {
      storageKey,
      thumbnailKey: null,
      fileName: ensureExtension(fileName, extension),
      mimeType,
      size: input.length,
      width: null,
      height: null,
      base64: input.toString('base64'),
    };
  }

  private async markMediaError(
    tenantId: string,
    conversationId: string,
    messageId: string,
    currentMetadata: Prisma.JsonValue,
    errorCode: string,
  ): Promise<void> {
    const metadata = isRecord(currentMetadata) ? currentMetadata : {};
    await this.prisma.message.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, mediaError: errorCode } as Prisma.InputJsonValue },
    });
    this.realtime.emitToTenant(tenantId, 'conversation.updated', {
      conversationId,
      messageId,
    });
  }

  private async touchConversation(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
  }

  /**
   * Finds the conversation for an instance/contact or creates it. Reuses the
   * same `(whatsappInstanceId, externalContactId)` key as the webhook, so a
   * reply from the contact lands in the same conversation.
   */
  private async findOrCreateConversation(
    tenantId: string,
    whatsappInstanceId: string,
    externalContactId: string,
    contactId: string | null,
    isGroup = false,
    groupName: string | null = null,
    groupAvatarUrl: string | null = null,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, whatsappInstanceId, externalContactId },
      select: {
        id: true,
        contactId: true,
        status: true,
        deletedAt: true,
        isGroup: true,
        groupName: true,
        avatarUrl: true,
      },
    });

    if (existing) {
      const data: Prisma.ConversationUncheckedUpdateInput = {};
      if (existing.status === ConversationStatus.CLOSED) {
        data.status = ConversationStatus.OPEN;
        data.closedAt = null;
      }
      if (existing.deletedAt) {
        data.deletedAt = null;
      }
      if (!existing.contactId && contactId) {
        data.contactId = contactId;
      }
      if (isGroup && !existing.isGroup) {
        data.isGroup = true;
      }
      if (groupName && existing.groupName !== groupName) {
        data.groupName = groupName;
      }
      if (groupAvatarUrl && existing.avatarUrl !== groupAvatarUrl) {
        data.avatarUrl = groupAvatarUrl;
      }
      if (Object.keys(data).length > 0) {
        await this.prisma.conversation.update({ where: { id: existing.id }, data });
      }
      return { id: existing.id };
    }

    try {
      return await this.prisma.conversation.create({
        data: {
          tenantId,
          whatsappInstanceId,
          externalContactId,
          contactId,
          isGroup,
          ...(groupName ? { groupName } : {}),
          ...(groupAvatarUrl ? { avatarUrl: groupAvatarUrl } : {}),
          status: ConversationStatus.OPEN,
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.conversation.findFirst({
          where: { tenantId, whatsappInstanceId, externalContactId },
          select: { id: true },
        });
        if (raced) {
          return raced;
        }
      }
      throw error;
    }
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

export type MediaStorageResult =
  | 'stored'
  | 'missing'
  | 'missing_media_key'
  | 'fetch_failed'
  | 'too_large'
  | 'empty';

interface StoredMedia {
  storageKey: string;
  thumbnailKey: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  base64: string;
}

function isTranscribableAudio(message: {
  type: MessageType;
  direction: string;
  metadata: Prisma.JsonValue;
}): boolean {
  if (message.type !== MessageType.AUDIO || message.direction !== 'INBOUND') {
    return false;
  }
  return !(isRecord(message.metadata) && message.metadata.viewOnce === true);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function decodeBase64(value: string): Buffer | null {
  const commaIndex = value.indexOf('base64,');
  const payload = commaIndex >= 0 ? value.slice(commaIndex + 'base64,'.length) : value;
  const cleaned = payload.replace(/\s/g, '');
  if (cleaned.length === 0) {
    return null;
  }
  return Buffer.from(cleaned, 'base64');
}

function mediaTypeForMessage(type: MessageType): EvolutionMediaType {
  switch (type) {
    case MessageType.IMAGE:
      return 'image';
    case MessageType.VIDEO:
      return 'video';
    case MessageType.AUDIO:
      return 'audio';
    default:
      return 'document';
  }
}

function normalizeMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

function messageTypeForMime(mimeType: string): MessageType {
  const mime = normalizeMime(mimeType);
  if (mime.startsWith('image/')) return MessageType.IMAGE;
  if (mime.startsWith('video/')) return MessageType.VIDEO;
  if (mime.startsWith('audio/')) return MessageType.AUDIO;
  return MessageType.DOCUMENT;
}

function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'text/plain': 'txt',
  };
  return map[normalizeMime(mimeType)] ?? 'bin';
}

function ensureExtension(fileName: string, extension: string): string {
  const base = fileName.replace(/[^\w.\- ]/g, '_').trim() || 'file';
  return base.includes('.') ? base : `${base}.${extension}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function authorMetadata(author: OutboundAuthor): Record<string, unknown> {
  return author.showAgentName && author.senderName ? { showAgentName: true } : {};
}

function buildMetadata(
  author: OutboundAuthor,
  quoted: QuotedMessageInfo | null,
  options: DeliverTextOptions = {},
): Record<string, unknown> {
  const metadata = authorMetadata(author);
  if (quoted) {
    metadata.quoted = quoted;
  }
  if (options.preview) {
    metadata.linkPreview = options.preview;
  }
  if (options.linkPreview === false) {
    metadata.suppressLinkPreview = true;
  }
  return metadata;
}

function buildEvolutionQuoted(
  externalContactId: string | null,
  quoted: QuotedMessageInfo | null,
): EvolutionQuotedMessage | null {
  if (!quoted?.externalId || !externalContactId) {
    return null;
  }

  const key: EvolutionQuotedMessage['key'] = {
    id: quoted.externalId,
    remoteJid: externalContactId,
    fromMe: quoted.fromMe,
  };
  if (!quoted.fromMe && quoted.authorJid) {
    key.participant = quoted.authorJid;
  }

  return {
    key,
    message: { conversation: quoted.content ?? '' },
  };
}

function readQuotedFromMetadata(metadata: unknown): QuotedMessageInfo | null {
  if (!isRecord(metadata) || !isRecord(metadata.quoted)) {
    return null;
  }
  const quoted = metadata.quoted;
  return {
    messageId: typeof quoted.messageId === 'string' ? quoted.messageId : null,
    externalId: typeof quoted.externalId === 'string' ? quoted.externalId : null,
    authorName: typeof quoted.authorName === 'string' ? quoted.authorName : null,
    authorJid: typeof quoted.authorJid === 'string' ? quoted.authorJid : null,
    fromMe: quoted.fromMe === true,
    content: typeof quoted.content === 'string' ? quoted.content : null,
    type: typeof quoted.type === 'string' ? (quoted.type as MessageType) : MessageType.UNKNOWN,
  };
}

function buildOutboundText(
  text: string | null,
  author: Pick<OutboundAuthor, 'senderName' | 'showAgentName'>,
): string | null {
  if (!text || !author.showAgentName || !author.senderName) {
    return text;
  }
  return `*${author.senderName}:*\n${text}`;
}

function isRetryableOutbound(message: {
  direction: unknown;
  status: MessageStatus;
  externalMessageId: string | null;
}): boolean {
  return (
    message.direction === 'OUTBOUND' &&
    (message.status === MessageStatus.PENDING || message.status === MessageStatus.FAILED) &&
    message.externalMessageId === null
  );
}

/** A fallback resend targets a message the provider accepted but failed. */
function isFallbackEligible(message: { direction: unknown; status: MessageStatus }): boolean {
  return message.direction === 'OUTBOUND' && message.status === MessageStatus.FAILED;
}

function isSendable(
  message: { direction: unknown; status: MessageStatus; externalMessageId: string | null },
  fallback: boolean,
): boolean {
  return fallback ? isFallbackEligible(message) : isRetryableOutbound(message);
}

interface SendFailure {
  code: string;
  retryable: boolean;
}

function classifySendFailure(error: unknown): SendFailure {
  if (error instanceof EvolutionUnavailableError) {
    return { code: 'EVOLUTION_UNAVAILABLE', retryable: false };
  }
  if (error instanceof EvolutionRequestError) {
    const status = error.httpStatus;
    if (status === undefined) {
      // The request never completed (timeout/DNS/socket): acceptance is unknown.
      return { code: 'EVOLUTION_NETWORK_UNCERTAIN', retryable: false };
    }
    return {
      code: `EVOLUTION_HTTP_${status}`,
      retryable: status === 429 || status >= 500,
    };
  }
  return { code: 'EVOLUTION_SEND_FAILED', retryable: false };
}

function sanitizeError(error: unknown): { name: string; message: string; httpStatus?: number } {
  if (error instanceof EvolutionRequestError) {
    return {
      name: error.name,
      message: error.message,
      ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'UnknownError', message: 'unknown' };
}
