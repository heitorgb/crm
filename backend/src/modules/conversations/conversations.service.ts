import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatus, MessageDirection, Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { WhatsAppDirectoryService } from '../whatsapp/whatsapp-directory.service.js';
import {
  ConversationProcessingService,
  type DeliverMediaInput,
  type OutboundAuthor,
} from './conversation-processing.service.js';
import type { QuotedMessageInfo } from './messages.service.js';
import {
  ContactPhoneRequiredError,
  ConversationNotFoundError,
  WhatsAppInstanceNotFoundError,
} from './conversations.errors.js';
import { ContactNotFoundError } from '../contacts/contacts.errors.js';
import type {
  CreateConversationDto,
  ListConversationsQueryDto,
  StartConversationDto,
  UpdateConversationDto,
} from './dto/conversation.dto.js';

export interface ConversationLastMessageView {
  content: string | null;
  direction: MessageDirection;
  senderName: string | null;
  occurredAt: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConversationView {
  id: string;
  status: ConversationStatus;
  subject: string | null;
  isGroup: boolean;
  groupName: string | null;
  avatarUrl: string | null;
  isPinned: boolean;
  isArchived: boolean;
  unreadCount: number;
  whatsappInstanceId: string;
  instanceName: string;
  externalContactId: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  customerId: string | null;
  customerName: string | null;
  lastMessageAt: Date | null;
  lastMessage: ConversationLastMessageView | null;
  createdAt: Date;
  updatedAt: Date;
}

const CONVERSATION_INCLUDE = {
  instance: { select: { name: true } },
  contact: { select: { name: true, phone: true } },
  customer: { select: { name: true } },
  messages: {
    take: 1,
    orderBy: { occurredAt: 'desc' as const },
    select: { content: true, direction: true, senderName: true, occurredAt: true },
  },
} satisfies Prisma.ConversationInclude;

type PrismaConversation = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly processing: ConversationProcessingService,
    private readonly directory: WhatsAppDirectoryService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(query: ListConversationsQueryDto): Promise<PageResult<ConversationView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.ConversationWhereInput = { tenantId };

    if (query.status) where.status = query.status;
    if (query.whatsappInstanceId) where.whatsappInstanceId = query.whatsappInstanceId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.customerId) where.customerId = query.customerId;
    where.isArchived = query.archived ?? false;
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { groupName: { contains: query.search, mode: 'insensitive' } },
        { contact: { name: { contains: query.search, mode: 'insensitive' } } },
        { contact: { phone: { contains: query.search, mode: 'insensitive' } } },
        { externalContactId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, conversations] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        orderBy: [
          { isPinned: 'desc' },
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: CONVERSATION_INCLUDE,
      }),
    ]);

    const unread = await this.countUnreadByConversation(
      tenantId,
      conversations.map((conversation) => conversation.id),
    );

    return buildPage(
      conversations.map((conversation) =>
        toConversationView(conversation, unread.get(conversation.id) ?? 0),
      ),
      total,
      query.page,
      query.perPage,
    );
  }

  async findOne(id: string): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: CONVERSATION_INCLUDE,
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    const unread = await this.countUnreadByConversation(tenantId, [conversation.id]);

    return toConversationView(conversation, unread.get(conversation.id) ?? 0);
  }

  async create(dto: CreateConversationDto): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireInstance(tenantId, dto.whatsappInstanceId);

    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId,
        whatsappInstanceId: dto.whatsappInstanceId,
        externalContactId: dto.externalContactId ?? null,
        contactId: dto.contactId ?? null,
        customerId: dto.customerId ?? null,
        subject: dto.subject ?? null,
      },
      include: CONVERSATION_INCLUDE,
    });

    return toConversationView(conversation, 0);
  }

  /**
   * Starts (or resumes) a conversation with a registered contact from the
   * operator side, without waiting for an inbound WhatsApp message.
   */
  async startFromContact(dto: StartConversationDto): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();

    const contact = await this.prisma.contact.findFirst({
      where: { id: dto.contactId, tenantId },
      select: { id: true, phone: true },
    });
    if (!contact) {
      throw new ContactNotFoundError();
    }
    if (!contact.phone) {
      throw new ContactPhoneRequiredError();
    }

    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { id: dto.whatsappInstanceId, tenantId },
      select: { id: true },
    });
    if (!instance) {
      throw new WhatsAppInstanceNotFoundError();
    }

    const jid = `${contact.phone}@s.whatsapp.net`;
    const variants = Array.from(new Set([contact.phone, jid, `${contact.phone}@c.us`]));

    const existing = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        whatsappInstanceId: instance.id,
        OR: [{ contactId: contact.id }, { externalContactId: { in: variants } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, contactId: true },
    });

    if (existing) {
      const data: Prisma.ConversationUncheckedUpdateInput = {};
      if (existing.status === ConversationStatus.CLOSED) {
        data.status = ConversationStatus.OPEN;
        data.closedAt = null;
      }
      if (!existing.contactId) {
        data.contactId = contact.id;
      }
      if (Object.keys(data).length > 0) {
        await this.prisma.conversation.update({ where: { id: existing.id }, data });
      }
      return this.findOne(existing.id);
    }

    try {
      const created = await this.prisma.conversation.create({
        data: {
          tenantId,
          whatsappInstanceId: instance.id,
          externalContactId: jid,
          contactId: contact.id,
          status: ConversationStatus.OPEN,
        },
        select: { id: true },
      });
      return this.findOne(created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.conversation.findFirst({
          where: { tenantId, whatsappInstanceId: instance.id, externalContactId: jid },
          select: { id: true },
        });
        if (raced) {
          return this.findOne(raced.id);
        }
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateConversationDto): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireConversation(tenantId, id);

    const data: Prisma.ConversationUncheckedUpdateInput = {};
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.contactId !== undefined) data.contactId = dto.contactId;
    if (dto.customerId !== undefined) data.customerId = dto.customerId;
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.closedAt = dto.status === ConversationStatus.CLOSED ? new Date() : null;
    }

    await this.prisma.conversation.update({ where: { id }, data });
    return this.findOne(id);
  }

  async takeover(id: string): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireConversation(tenantId, id);

    await this.prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.OPEN, closedAt: null },
    });

    this.realtime.emitToTenant(tenantId, 'conversation.updated', {
      conversationId: id,
      status: ConversationStatus.OPEN,
    });

    return this.findOne(id);
  }

  async close(id: string): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireConversation(tenantId, id);

    await this.prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.CLOSED, closedAt: new Date() },
    });

    return this.findOne(id);
  }

  /** Pins a conversation to the top of the inbox (tenant-scoped, idempotent). */
  async pin(id: string): Promise<ConversationView> {
    return this.setPinned(id, true);
  }

  /** Removes the pinned flag from a conversation (tenant-scoped, idempotent). */
  async unpin(id: string): Promise<ConversationView> {
    return this.setPinned(id, false);
  }

  private async setPinned(id: string, isPinned: boolean): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true, isPinned: true },
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    if (conversation.isPinned !== isPinned) {
      await this.prisma.conversation.update({ where: { id }, data: { isPinned } });
    }

    this.realtime.emitToTenant(tenantId, 'conversation.updated', { conversationId: id });

    return this.findOne(id);
  }

  /** Archives a conversation, removing it from the default inbox (tenant-scoped, idempotent). */
  async archive(id: string): Promise<ConversationView> {
    return this.setArchived(id, true);
  }

  /** Restores an archived conversation to the default inbox (tenant-scoped, idempotent). */
  async unarchive(id: string): Promise<ConversationView> {
    return this.setArchived(id, false);
  }

  private async setArchived(id: string, isArchived: boolean): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true, isArchived: true },
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    if (conversation.isArchived !== isArchived) {
      await this.prisma.conversation.update({ where: { id }, data: { isArchived } });
    }

    this.realtime.emitToTenant(tenantId, 'conversation.updated', { conversationId: id });

    return this.findOne(id);
  }

  /**
   * Marks the conversation as read for every authorized user of the tenant.
   * The read marker advances to the latest inbound message already persisted,
   * so a message received during the operation is never lost from the counter.
   * Tenant-scoped and idempotent: repeated calls do not change the state.
   */
  async markAsRead(id: string): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true, lastReadAt: true },
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    const latestInbound = await this.prisma.message.findFirst({
      where: { tenantId, conversationId: id, direction: MessageDirection.INBOUND },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });

    const marker = latestInbound?.occurredAt ?? new Date();
    if (!conversation.lastReadAt || marker > conversation.lastReadAt) {
      await this.prisma.conversation.update({
        where: { id },
        data: { lastReadAt: marker },
      });
      this.realtime.emitToTenant(tenantId, 'conversation.updated', { conversationId: id });
    }

    return this.findOne(id);
  }

  /** Total inbound messages still unread across the tenant inbox (archived excluded). */
  async unreadTotal(): Promise<{ total: number }> {
    const { tenantId } = this.tenantContext.requireContext();
    const rows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS "total"
      FROM "messages" m
      JOIN "conversations" c ON c."id" = m."conversation_id"
      WHERE c."tenant_id" = ${tenantId}::uuid
        AND c."is_archived" = false
        AND m."direction" = 'INBOUND'
        AND (c."last_read_at" IS NULL OR m."occurred_at" > c."last_read_at")
    `;

    return { total: Number(rows[0]?.total ?? 0) };
  }

  /**
   * Counts unread inbound messages per conversation in a single aggregate query,
   * honoring each conversation's own last-read marker.
   */
  private async countUnreadByConversation(
    tenantId: string,
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.$queryRaw<Array<{ conversationId: string; unread: bigint }>>`
      SELECT m."conversation_id" AS "conversationId", COUNT(*)::bigint AS "unread"
      FROM "messages" m
      JOIN "conversations" c ON c."id" = m."conversation_id"
      WHERE c."tenant_id" = ${tenantId}::uuid
        AND m."conversation_id" IN (${Prisma.join(conversationIds)})
        AND m."direction" = 'INBOUND'
        AND (c."last_read_at" IS NULL OR m."occurred_at" > c."last_read_at")
      GROUP BY m."conversation_id"
    `;

    return new Map(rows.map((row) => [row.conversationId, Number(row.unread)]));
  }

  async sendHumanMessage(
    id: string,
    content: string,
    includeAgentName: boolean,
    quotedMessageId: string | null = null,
  ): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    if (conversation.status === ConversationStatus.CLOSED) {
      await this.prisma.conversation.update({
        where: { id },
        data: { status: ConversationStatus.OPEN, closedAt: null },
      });
    }

    const author = await this.resolveAuthor(includeAgentName);
    const quoted = await this.resolveQuoted(tenantId, id, quotedMessageId);
    await this.processing.deliverText(tenantId, id, content, author, quoted);
  }

  async sendHumanMedia(
    id: string,
    input: DeliverMediaInput,
    includeAgentName: boolean,
    quotedMessageId: string | null = null,
  ): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    if (input.buffer.length === 0) {
      throw new AppException('MEDIA_EMPTY', 'Arquivo vazio.', 400);
    }

    const maxBytes = this.config.get('MEDIA_MAX_BYTES');
    if (input.buffer.length > maxBytes) {
      throw new AppException('MEDIA_TOO_LARGE', 'Arquivo maior que o permitido.', 413);
    }

    if (conversation.status === ConversationStatus.CLOSED) {
      await this.prisma.conversation.update({
        where: { id },
        data: { status: ConversationStatus.OPEN, closedAt: null },
      });
    }

    const author = await this.resolveAuthor(includeAgentName);
    const quoted = await this.resolveQuoted(tenantId, id, quotedMessageId);
    await this.processing.deliverMedia(tenantId, id, input, author, quoted);
  }

  private async resolveAuthor(showAgentName: boolean): Promise<OutboundAuthor> {
    const { userId } = this.tenantContext.requireContext();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    return { senderId: userId, senderName: user?.name ?? null, showAgentName };
  }

  private async resolveQuoted(
    tenantId: string,
    conversationId: string,
    quotedMessageId: string | null,
  ): Promise<QuotedMessageInfo | null> {
    if (!quotedMessageId) {
      return null;
    }

    if (!UUID_PATTERN.test(quotedMessageId)) {
      return null;
    }

    const message = await this.prisma.message.findFirst({
      where: { id: quotedMessageId, tenantId, conversationId },
      select: {
        id: true,
        externalMessageId: true,
        senderName: true,
        senderId: true,
        direction: true,
        content: true,
        type: true,
      },
    });
    if (!message) {
      return null;
    }

    return {
      messageId: message.id,
      externalId: message.externalMessageId,
      authorName: message.senderName,
      authorJid: message.senderId,
      fromMe: message.direction === MessageDirection.OUTBOUND,
      content: message.content,
      type: message.type,
    };
  }

  /** Resolves the WhatsApp avatar of a participant that belongs to this conversation. */
  async resolveParticipantAvatar(id: string, jid: string): Promise<{ url: string | null }> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        externalContactId: true,
        whatsappInstanceId: true,
        instance: { select: { instanceName: true } },
      },
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    const participantMessage = await this.prisma.message.findFirst({
      where: { tenantId, conversationId: id, senderId: jid },
      select: { id: true },
    });
    const isParticipant =
      conversation.externalContactId === jid || participantMessage !== null;

    if (!isParticipant) {
      throw new AppException('AVATAR_NOT_AVAILABLE', 'Participante não encontrado.', 404);
    }

    const url = await this.directory.resolveAvatar({
      tenantId,
      whatsappInstanceId: conversation.whatsappInstanceId,
      instanceName: conversation.instance.instanceName,
      jid,
    });

    return { url };
  }

  /** Re-resolves group name/avatar from Evolution for an existing conversation. */
  async refreshGroupMetadata(id: string): Promise<ConversationView> {
    const { tenantId } = this.tenantContext.requireContext();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        externalContactId: true,
        instance: { select: { instanceName: true } },
      },
    });

    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    const groupJid = conversation.externalContactId;
    if (!groupJid || !groupJid.endsWith('@g.us')) {
      throw new AppException('NOT_A_GROUP', 'A conversa não é um grupo.', 400);
    }

    const info = await this.directory.resolveGroupInfo(
      conversation.instance.instanceName,
      groupJid,
    );

    const data: Prisma.ConversationUpdateInput = { isGroup: true };
    if (info?.name) data.groupName = info.name;
    if (info?.avatarUrl) data.avatarUrl = info.avatarUrl;

    await this.prisma.conversation.update({ where: { id }, data });
    this.realtime.emitToTenant(tenantId, 'conversation.updated', { conversationId: id });

    return this.findOne(id);
  }

  private async requireConversation(tenantId: string, id: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!conversation) {
      throw new ConversationNotFoundError();
    }
  }

  private async requireInstance(tenantId: string, instanceId: string): Promise<void> {
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { id: instanceId, tenantId },
      select: { id: true },
    });
    if (!instance) {
      throw new ConversationNotFoundError();
    }
  }
}

function toConversationView(
  conversation: PrismaConversation,
  unreadCount: number,
): ConversationView {
  const lastMessage = conversation.messages[0] ?? null;
  return {
    id: conversation.id,
    status: conversation.status,
    subject: conversation.subject,
    isGroup: conversation.isGroup,
    groupName: conversation.groupName,
    avatarUrl: conversation.avatarUrl,
    isPinned: conversation.isPinned,
    isArchived: conversation.isArchived,
    unreadCount,
    whatsappInstanceId: conversation.whatsappInstanceId,
    instanceName: conversation.instance.name,
    externalContactId: conversation.externalContactId,
    contactId: conversation.contactId,
    contactName: conversation.contact?.name ?? null,
    contactPhone: conversation.contact?.phone ?? null,
    customerId: conversation.customerId,
    customerName: conversation.customer?.name ?? null,
    lastMessageAt: conversation.lastMessageAt,
    lastMessage: lastMessage
      ? {
          content: lastMessage.content,
          direction: lastMessage.direction,
          senderName: lastMessage.senderName,
          occurredAt: lastMessage.occurredAt,
        }
      : null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}
