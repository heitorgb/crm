import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageStatus, MessageType, Prisma } from '@prisma/client';
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
  type EvolutionMediaType,
  type EvolutionSendResult,
} from '../whatsapp/evolution/evolution.client.js';
import { MessagesService } from './messages.service.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';

type ConversationWithInstance = Prisma.ConversationGetPayload<{ include: { instance: true } }>;

export interface DeliverMediaInput {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  caption?: string | null;
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
  async deliverText(tenantId: string, conversationId: string, text: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true },
    });
    if (!conversation) {
      return;
    }

    const outbound = await this.messages.persistOutbound({
      tenantId,
      conversationId: conversation.id,
      content: text,
    });

    await this.dispatch(
      tenantId,
      conversation,
      outbound.id,
      MessageType.TEXT,
      text,
      null,
      text,
    );
  }

  /** Optimizes, stores and sends an uploaded media file. */
  async deliverMedia(
    tenantId: string,
    conversationId: string,
    input: DeliverMediaInput,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { instance: true },
    });
    if (!conversation) {
      return;
    }

    const isImage = await this.media.isImage(input.buffer);
    const type = isImage ? MessageType.IMAGE : messageTypeForMime(input.mimeType);
    const caption = type === MessageType.AUDIO ? null : (input.caption?.trim() || null);

    const stored = isImage
      ? await this.storeImage(tenantId, 'outbound', input.buffer, input.fileName)
      : await this.storeFile(tenantId, 'outbound', input.buffer, input.fileName, input.mimeType);

    const outbound = await this.messages.persistOutbound({
      tenantId,
      conversationId: conversation.id,
      content: caption,
      type,
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
      caption,
    );
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
        include: { conversation: { include: { instance: true } } },
      });
      if (!message || message.direction !== 'INBOUND') {
        return;
      }

      const alreadyStored = await this.prisma.messageAttachment.count({ where: { messageId } });
      if (alreadyStored > 0) {
        return;
      }

      const conversation = message.conversation;
      const remoteJid = conversation.externalContactId;
      const externalId = message.externalMessageId;
      if (!externalId || !remoteJid) {
        await this.markMediaError(
          tenantId,
          conversation.id,
          messageId,
          message.metadata,
          'missing_media_key',
        );
        return;
      }

      let content;
      try {
        content = await this.evolution.getBase64FromMediaMessage(
          conversation.instance.instanceName,
          { id: externalId, remoteJid, fromMe: false },
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
        return;
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
        return;
      }

      const buffer = decodeBase64(content.base64);
      if (!buffer || buffer.length === 0) {
        await this.markMediaError(tenantId, conversation.id, messageId, message.metadata, 'empty');
        return;
      }
      if (buffer.length > maxBytes) {
        await this.markMediaError(
          tenantId,
          conversation.id,
          messageId,
          message.metadata,
          'too_large',
        );
        return;
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
        include: { conversation: { include: { instance: true } }, attachments: true },
      });

      if (!message || message.direction !== 'OUTBOUND' || message.status === MessageStatus.SENT) {
        return;
      }

      const conversation = message.conversation;
      const destination = deliveryDestination(conversation.externalContactId);

      try {
        if (!this.evolution.configured || !destination) {
          throw new Error('Evolution API not configured or destination missing');
        }

        const attachment = message.attachments[0];
        let sent: EvolutionSendResult;
        if (attachment && message.type === MessageType.AUDIO) {
          sent = await this.evolution.sendWhatsAppAudio(conversation.instance.instanceName, {
            number: destination,
            audio: (await this.storage.get(attachment.storageKey)).toString('base64'),
          });
        } else if (attachment) {
          sent = await this.evolution.sendMedia(conversation.instance.instanceName, {
            number: destination,
            mediatype: mediaTypeForMessage(message.type),
            media: (await this.storage.get(attachment.storageKey)).toString('base64'),
            fileName: attachment.fileName,
            mimetype: attachment.mimeType,
            ...(message.content ? { caption: message.content } : {}),
          });
        } else {
          sent = await this.evolution.sendText(
            conversation.instance.instanceName,
            destination,
            message.content ?? '',
          );
        }

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

  private async dispatch(
    tenantId: string,
    conversation: ConversationWithInstance,
    messageId: string,
    type: MessageType,
    mediaOrText: string,
    file: { mimeType: string; fileName: string } | null,
    caption: string | null,
  ): Promise<void> {
    const destination = deliveryDestination(conversation.externalContactId);

    try {
      if (!this.evolution.configured || !destination) {
        throw new Error('Evolution API not configured or destination missing');
      }

      const sent =
        file && type === MessageType.AUDIO
          ? await this.evolution.sendWhatsAppAudio(conversation.instance.instanceName, {
              number: destination,
              audio: mediaOrText,
            })
          : file
            ? await this.evolution.sendMedia(conversation.instance.instanceName, {
                number: destination,
                mediatype: mediaTypeForMessage(type),
                media: mediaOrText,
                fileName: file.fileName,
                mimetype: file.mimeType,
                ...(caption ? { caption } : {}),
              })
            : await this.evolution.sendText(
                conversation.instance.instanceName,
                destination,
                mediaOrText,
              );

      await this.messages.markOutboundStatus(messageId, MessageStatus.SENT, sent.externalMessageId);
    } catch {
      await this.messages.markOutboundFailed(messageId, 'EVOLUTION_SEND_FAILED');
      await this.queue.enqueue(JOB_NAMES.WHATSAPP_SEND, { tenantId, messageId });
    }

    await this.touchConversation(conversation.id);
    this.realtime.emitToConversation(tenantId, conversation.id, 'message.created', {
      conversationId: conversation.id,
      messageId,
    });
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

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function deliveryDestination(externalContactId: string | null): string {
  const value = externalContactId ?? '';
  return value.endsWith('@g.us') ? value : normalizePhone(value);
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
