import { Injectable } from '@nestjs/common';
import { MessageDirection, MessageStatus, MessageType, Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ConversationNotFoundError, MessageNotFoundError } from './conversations.errors.js';

export interface MessageAttachmentView {
  id: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface MessageView {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  externalMessageId: string | null;
  status: MessageStatus;
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

const MESSAGE_INCLUDE = {
  attachments: {
    select: { id: true, storageKey: true, fileName: true, mimeType: true, size: true },
  },
} satisfies Prisma.MessageInclude;

type PrismaMessage = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
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
    metadata: message.metadata,
    occurredAt: message.occurredAt,
    createdAt: message.createdAt,
    attachments: message.attachments,
  };
}
