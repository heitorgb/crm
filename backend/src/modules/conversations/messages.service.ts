import { Inject, Injectable } from '@nestjs/common';
import { MessageDirection, MessageStatus, MessageType, Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import { ConversationNotFoundError, MessageNotFoundError } from './conversations.errors.js';

export interface MessageAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
}

export interface MessageView {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  externalMessageId: string | null;
  status: MessageStatus;
  senderId: string | null;
  senderName: string | null;
  metadata: Prisma.JsonValue;
  occurredAt: Date;
  createdAt: Date;
  attachments: MessageAttachmentView[];
}

export interface PersistInboundInput {
  tenantId: string;
  conversationId: string;
  content: string | null;
  externalMessageId?: string | null;
  type?: MessageType;
  senderId?: string | null;
  senderName?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface PersistOutboundInput {
  tenantId: string;
  conversationId: string;
  content: string | null;
  externalMessageId?: string | null;
  status?: MessageStatus;
  type?: MessageType;
  metadata?: Record<string, unknown>;
}

export interface CreateAttachmentInput {
  tenantId: string;
  messageId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  thumbnailKey?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface StoredAttachment {
  id: string;
  messageId: string;
  storageKey: string;
  thumbnailKey: string | null;
  fileName: string;
  mimeType: string;
  size: number;
}

const MESSAGE_INCLUDE = {
  attachments: {
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      size: true,
      metadata: true,
    },
  },
} satisfies Prisma.MessageInclude;

type PrismaMessage = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Inject(STORAGE) private readonly storage: StorageService,
  ) {}

  async listByConversation(
    conversationId: string,
    page: number,
    perPage: number,
  ): Promise<PageResult<MessageView>> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireConversation(tenantId, conversationId);

    return this.listByConversationId(tenantId, conversationId, page, perPage);
  }

  /** System variant used by the webhook/processing where no tenant context exists. */
  async listByConversationId(
    tenantId: string,
    conversationId: string,
    page: number,
    perPage: number,
  ): Promise<PageResult<MessageView>> {
    const [total, messages] = await this.prisma.$transaction([
      this.prisma.message.count({ where: { tenantId, conversationId } }),
      this.prisma.message.findMany({
        where: { tenantId, conversationId },
        orderBy: { occurredAt: 'asc' },
        skip: skipOf(page, perPage),
        take: perPage,
        include: MESSAGE_INCLUDE,
      }),
    ]);

    return buildPage(messages.map(toMessageView), total, page, perPage);
  }

  async findOne(id: string): Promise<MessageView> {
    const { tenantId } = this.tenantContext.requireContext();
    const message = await this.prisma.message.findFirst({
      where: { id, tenantId },
      include: MESSAGE_INCLUDE,
    });

    if (!message) {
      throw new MessageNotFoundError();
    }

    return toMessageView(message);
  }

  /** Idempotent inbound persistence by (tenantId, externalMessageId). */
  async persistInbound(input: PersistInboundInput): Promise<MessageView | null> {
    try {
      const message = await this.prisma.message.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          direction: MessageDirection.INBOUND,
          type: input.type ?? MessageType.TEXT,
          content: input.content,
          externalMessageId: input.externalMessageId ?? null,
          status: MessageStatus.RECEIVED,
          senderId: input.senderId ?? null,
          senderName: input.senderName ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        },
        include: MESSAGE_INCLUDE,
      });
      return toMessageView(message);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  async persistOutbound(input: PersistOutboundInput): Promise<MessageView> {
    const message = await this.prisma.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: input.type ?? MessageType.TEXT,
        content: input.content,
        externalMessageId: input.externalMessageId ?? null,
        status: input.status ?? MessageStatus.PENDING,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      include: MESSAGE_INCLUDE,
    });

    return toMessageView(message);
  }

  async createAttachment(input: CreateAttachmentInput): Promise<string> {
    const metadata: Record<string, unknown> = {};
    if (input.thumbnailKey) metadata.thumbnailKey = input.thumbnailKey;
    if (input.width != null) metadata.width = input.width;
    if (input.height != null) metadata.height = input.height;

    const attachment = await this.prisma.messageAttachment.create({
      data: {
        tenantId: input.tenantId,
        messageId: input.messageId,
        storageKey: input.storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.size,
        metadata: metadata as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    return attachment.id;
  }

  /** Tenant-scoped lookup used by the media download endpoint. */
  async findAttachment(input: {
    tenantId: string;
    conversationId: string;
    messageId: string;
    attachmentId: string;
  }): Promise<StoredAttachment> {
    const message = await this.prisma.message.findFirst({
      where: { id: input.messageId, tenantId: input.tenantId, conversationId: input.conversationId },
      select: { id: true },
    });
    if (!message) {
      throw new MessageNotFoundError();
    }

    const attachment = await this.prisma.messageAttachment.findFirst({
      where: { id: input.attachmentId, tenantId: input.tenantId, messageId: input.messageId },
    });
    if (!attachment) {
      throw new MessageNotFoundError();
    }

    const metadata = isRecord(attachment.metadata) ? attachment.metadata : {};

    return {
      id: attachment.id,
      messageId: attachment.messageId,
      storageKey: attachment.storageKey,
      thumbnailKey: typeof metadata.thumbnailKey === 'string' ? metadata.thumbnailKey : null,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    };
  }

  /** Reads an attachment from storage for the authenticated download endpoint. */
  async readAttachment(input: {
    conversationId: string;
    messageId: string;
    attachmentId: string;
    variant: 'main' | 'thumb';
  }): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const { tenantId } = this.tenantContext.requireContext();
    const attachment = await this.findAttachment({
      tenantId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      attachmentId: input.attachmentId,
    });

    const key =
      input.variant === 'thumb' && attachment.thumbnailKey
        ? attachment.thumbnailKey
        : attachment.storageKey;

    return {
      buffer: await this.storage.get(key),
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
    };
  }

  async markOutboundStatus(
    messageId: string,
    status: MessageStatus,
    externalMessageId?: string,
  ): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        status,
        ...(externalMessageId ? { externalMessageId } : {}),
      },
    });
  }

  async markOutboundFailed(messageId: string, errorCode: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, metadata: { errorCode } as Prisma.InputJsonValue },
    });
  }

  private async requireConversation(tenantId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true },
    });
    if (!conversation) {
      throw new ConversationNotFoundError();
    }
  }
}

function toMessageView(message: PrismaMessage): MessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    type: message.type,
    content: message.content,
    externalMessageId: message.externalMessageId,
    status: message.status,
    senderId: message.senderId,
    senderName: message.senderName,
    metadata: message.metadata,
    occurredAt: message.occurredAt,
    createdAt: message.createdAt,
    attachments: message.attachments.map((attachment) => {
      const metadata = isRecord(attachment.metadata) ? attachment.metadata : {};
      return {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        width: typeof metadata.width === 'number' ? metadata.width : null,
        height: typeof metadata.height === 'number' ? metadata.height : null,
        hasThumbnail: typeof metadata.thumbnailKey === 'string',
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
