import { Inject, Injectable } from '@nestjs/common';
import { MessageDirection, MessageStatus, MessageType, Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import {
  toTranscriptionView,
  type MessageTranscriptionView,
} from '../transcription/transcription.view.js';
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

export interface MessageReactionView {
  id: string;
  reactorId: string;
  reactorName: string | null;
  fromMe: boolean;
  emoji: string;
  occurredAt: Date;
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
  transcription: MessageTranscriptionView | null;
  reactions: MessageReactionView[];
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
  senderId?: string | null;
  senderName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface QuotedMessageInfo {
  messageId: string | null;
  externalId: string | null;
  authorName: string | null;
  authorJid: string | null;
  fromMe: boolean;
  content: string | null;
  type: MessageType;
}

export interface ApplyMessageEditInput {
  tenantId: string;
  whatsappInstanceId: string;
  externalMessageId: string;
  content: string | null;
  type: MessageType;
}

export interface ApplyMessageEditByIdInput {
  tenantId: string;
  messageId: string;
  content: string | null;
}

export interface AppliedMessageEdit {
  messageId: string;
  conversationId: string;
}

export interface ApplyMessageReactionInput {
  tenantId: string;
  conversationId: string;
  targetExternalId: string;
  targetFromMe: boolean;
  reactorId: string;
  reactorName: string | null;
  fromMe: boolean;
  emoji: string;
  occurredAt: Date;
}

export type AppliedMessageReaction =
  | {
      applied: true;
      removed: boolean;
      changed: boolean;
      messageId: string | null;
      conversationId: string;
      reactions: MessageReactionView[];
    }
  | { applied: false; reason: 'cross_conversation_target' };

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
  transcription: true,
} satisfies Prisma.MessageInclude;

type PrismaMessage = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;
type PrismaMessageReaction = Prisma.MessageReactionGetPayload<object>;

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
        orderBy: { occurredAt: 'desc' },
        skip: skipOf(page, perPage),
        take: perPage,
        include: MESSAGE_INCLUDE,
      }),
    ]);

    const ascending = [...messages].reverse();
    const reactions = await this.reactionsByTargetExternalId(
      tenantId,
      conversationId,
      ascending.flatMap((message) =>
        message.externalMessageId ? [message.externalMessageId] : [],
      ),
    );

    return buildPage(
      ascending.map((message) =>
        toMessageView(
          message,
          message.externalMessageId ? (reactions.get(message.externalMessageId) ?? []) : [],
        ),
      ),
      total,
      page,
      perPage,
    );
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

    const reactions = message.externalMessageId
      ? await this.listReactionsForTarget(tenantId, message.conversationId, message.externalMessageId)
      : [];

    return toMessageView(message, reactions);
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
        senderId: input.senderId ?? null,
        senderName: input.senderName ?? null,
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
    metadataPatch?: Record<string, unknown>,
  ): Promise<void> {
    const data: Prisma.MessageUpdateInput = {
      status,
      ...(externalMessageId ? { externalMessageId } : {}),
    };
    if (metadataPatch) {
      const existing = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { metadata: true },
      });
      data.metadata = {
        ...(isRecord(existing?.metadata) ? existing.metadata : {}),
        ...metadataPatch,
      } as Prisma.InputJsonValue;
    }

    await this.prisma.message.update({ where: { id: messageId }, data });
  }

  async markOutboundFailed(messageId: string, errorCode: string): Promise<void> {
    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });
    const metadata = isRecord(existing?.metadata) ? existing.metadata : {};

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: MessageStatus.FAILED,
        metadata: {
          ...metadata,
          errorCode,
          failedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async markFallbackAttempted(messageId: string): Promise<void> {
    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });
    const metadata = isRecord(existing?.metadata) ? existing.metadata : {};

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        metadata: { ...metadata, fallbackAttempted: true } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * System variant used by the webhook to apply delivery/read receipts. Only
   * advances the status (never downgrades) and never touches inbound messages,
   * except for a provider ERROR, which is terminal: it may turn PENDING/SENT
   * into FAILED, but never regresses DELIVERED/READ or an already FAILED row.
   */
  async updateOutboundStatusByExternalId(input: {
    tenantId: string;
    externalMessageId: string;
    status: MessageStatus;
  }): Promise<{ messageId: string; conversationId: string; status: MessageStatus } | null> {
    const message = await this.prisma.message.findFirst({
      where: {
        tenantId: input.tenantId,
        externalMessageId: input.externalMessageId,
        direction: MessageDirection.OUTBOUND,
      },
      select: { id: true, conversationId: true, status: true },
    });
    if (!message || !shouldAdvanceStatus(message.status, input.status)) {
      return null;
    }

    await this.prisma.message.update({
      where: { id: message.id },
      data: { status: input.status },
    });

    return {
      messageId: message.id,
      conversationId: message.conversationId,
      status: input.status,
    };
  }

  /**
   * Applies a WhatsApp message edit in place. The original row keeps its id,
   * conversation, direction and sender; only the content (and, when the row was
   * still UNKNOWN, its type) changes and an edit marker is merged into metadata.
   * The lookup is scoped by tenant and instance, so an edit can never touch a
   * message from another conversation or tenant. Returns null when the original
   * message is not (yet) stored, so the caller can ignore it safely.
   */
  async applyEditByExternalId(input: ApplyMessageEditInput): Promise<AppliedMessageEdit | null> {
    const message = await this.prisma.message.findFirst({
      where: {
        tenantId: input.tenantId,
        externalMessageId: input.externalMessageId,
        conversation: { whatsappInstanceId: input.whatsappInstanceId },
      },
      select: { id: true, conversationId: true, type: true, metadata: true },
    });
    if (!message) {
      return null;
    }

    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const updatedMetadata: Record<string, unknown> = {
      ...metadata,
      edited: true,
      editedAt: new Date().toISOString(),
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: input.content,
        metadata: updatedMetadata as Prisma.InputJsonValue,
        ...(message.type === MessageType.UNKNOWN ? { type: input.type } : {}),
      },
    });

    return { messageId: message.id, conversationId: message.conversationId };
  }

  /**
   * Applies a human-initiated edit to a message already confirmed as editable.
   * The row keeps its id, conversation, direction and occurredAt; only the
   * content changes and the edit marker is merged into metadata. Tenant-scoped,
   * so it can never touch a message from another tenant.
   */
  async applyEditById(input: ApplyMessageEditByIdInput): Promise<AppliedMessageEdit | null> {
    const message = await this.prisma.message.findFirst({
      where: { id: input.messageId, tenantId: input.tenantId },
      select: { id: true, conversationId: true, metadata: true },
    });
    if (!message) {
      return null;
    }

    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const updatedMetadata: Record<string, unknown> = {
      ...metadata,
      edited: true,
      editedAt: new Date().toISOString(),
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: input.content,
        metadata: updatedMetadata as Prisma.InputJsonValue,
      },
    });

    return { messageId: message.id, conversationId: message.conversationId };
  }

  /**
   * Stores a WhatsApp reaction against the external id of its target message.
   * Reactions never become Message rows, so they cannot affect the inbox
   * preview, unread counters or conversation ordering. A reaction whose target
   * has not been synchronized yet is kept and becomes visible as soon as the
   * target message is imported.
   */
  async applyReaction(input: ApplyMessageReactionInput): Promise<AppliedMessageReaction> {
    const target = await this.prisma.message.findFirst({
      where: { tenantId: input.tenantId, externalMessageId: input.targetExternalId },
      select: { id: true, conversationId: true },
    });

    if (target && target.conversationId !== input.conversationId) {
      return { applied: false, reason: 'cross_conversation_target' };
    }

    const reactionKey = {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      targetExternalId: input.targetExternalId,
      reactorId: input.reactorId,
    };

    if (!input.emoji) {
      const deleted = await this.prisma.messageReaction.deleteMany({ where: reactionKey });
      return {
        applied: true,
        removed: true,
        changed: deleted.count > 0,
        messageId: target?.id ?? null,
        conversationId: input.conversationId,
        reactions: target
          ? await this.listReactionsForTarget(
              input.tenantId,
              input.conversationId,
              input.targetExternalId,
            )
          : [],
      };
    }

    await this.prisma.messageReaction.upsert({
      where: {
        message_reactions_target_reactor_key: reactionKey,
      },
      create: {
        ...reactionKey,
        targetFromMe: input.targetFromMe,
        reactorName: input.reactorName,
        fromMe: input.fromMe,
        emoji: input.emoji,
        occurredAt: input.occurredAt,
      },
      update: {
        targetFromMe: input.targetFromMe,
        reactorName: input.reactorName,
        fromMe: input.fromMe,
        emoji: input.emoji,
        occurredAt: input.occurredAt,
      },
    });

    return {
      applied: true,
      removed: false,
      changed: true,
      messageId: target?.id ?? null,
      conversationId: input.conversationId,
      reactions: target
        ? await this.listReactionsForTarget(
            input.tenantId,
            input.conversationId,
            input.targetExternalId,
          )
        : [],
    };
  }

  private async reactionsByTargetExternalId(
    tenantId: string,
    conversationId: string,
    targetExternalIds: string[],
  ): Promise<Map<string, MessageReactionView[]>> {
    if (targetExternalIds.length === 0) {
      return new Map();
    }

    const reactions = await this.prisma.messageReaction.findMany({
      where: {
        tenantId,
        conversationId,
        targetExternalId: { in: [...new Set(targetExternalIds)] },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const grouped = new Map<string, MessageReactionView[]>();
    for (const reaction of reactions) {
      const list = grouped.get(reaction.targetExternalId) ?? [];
      list.push(toMessageReactionView(reaction));
      grouped.set(reaction.targetExternalId, list);
    }
    return grouped;
  }

  private async listReactionsForTarget(
    tenantId: string,
    conversationId: string,
    targetExternalId: string,
  ): Promise<MessageReactionView[]> {
    const reactions = await this.prisma.messageReaction.findMany({
      where: { tenantId, conversationId, targetExternalId },
      orderBy: { occurredAt: 'asc' },
    });
    return reactions.map(toMessageReactionView);
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

function toMessageView(
  message: PrismaMessage,
  reactions: MessageReactionView[] = [],
): MessageView {
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
    transcription: message.transcription ? toTranscriptionView(message.transcription) : null,
    reactions,
  };
}

function toMessageReactionView(reaction: PrismaMessageReaction): MessageReactionView {
  return {
    id: reaction.id,
    reactorId: reaction.reactorId,
    reactorName: reaction.reactorName,
    fromMe: reaction.fromMe,
    emoji: reaction.emoji,
    occurredAt: reaction.occurredAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const OUTBOUND_STATUS_RANK: Record<MessageStatus, number> = {
  PENDING: 0,
  RECEIVED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: -1,
};

function shouldAdvanceStatus(current: MessageStatus, next: MessageStatus): boolean {
  if (current === next) {
    return false;
  }
  if (next === MessageStatus.FAILED) {
    // A provider ERROR is a terminal send outcome. A message that was only
    // accepted (PENDING) or acked (SENT) can still fail, but once DELIVERED or
    // READ the recipient already received it, so a late/out-of-order error must
    // never undo that. A message already FAILED stays FAILED (idempotent).
    return current === MessageStatus.PENDING || current === MessageStatus.SENT;
  }
  if (current === MessageStatus.FAILED) {
    return false;
  }
  return OUTBOUND_STATUS_RANK[next] > OUTBOUND_STATUS_RANK[current];
}
