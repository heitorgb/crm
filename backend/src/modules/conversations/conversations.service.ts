import { Injectable } from '@nestjs/common';
import { ConversationStatus, MessageDirection, Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ConversationProcessingService } from './conversation-processing.service.js';
import { ConversationNotFoundError } from './conversations.errors.js';
import type {
  CreateConversationDto,
  ListConversationsQueryDto,
  UpdateConversationDto,
} from './dto/conversation.dto.js';

export interface ConversationLastMessageView {
  content: string | null;
  direction: MessageDirection;
  occurredAt: Date;
}

export interface ConversationView {
  id: string;
  status: ConversationStatus;
  subject: string | null;
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
    select: { content: true, direction: true, occurredAt: true },
  },
} satisfies Prisma.ConversationInclude;

type PrismaConversation = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly processing: ConversationProcessingService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(query: ListConversationsQueryDto): Promise<PageResult<ConversationView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.ConversationWhereInput = { tenantId };

    if (query.status) where.status = query.status;
    if (query.whatsappInstanceId) where.whatsappInstanceId = query.whatsappInstanceId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { contact: { name: { contains: query.search, mode: 'insensitive' } } },
        { contact: { phone: { contains: query.search, mode: 'insensitive' } } },
        { externalContactId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, conversations] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: CONVERSATION_INCLUDE,
      }),
    ]);

    return buildPage(conversations.map(toConversationView), total, query.page, query.perPage);
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

    return toConversationView(conversation);
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

    return toConversationView(conversation);
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

  async sendHumanMessage(id: string, content: string): Promise<void> {
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

    await this.processing.deliverText(tenantId, id, content);
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

function toConversationView(conversation: PrismaConversation): ConversationView {
  const lastMessage = conversation.messages[0] ?? null;
  return {
    id: conversation.id,
    status: conversation.status,
    subject: conversation.subject,
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
          occurredAt: lastMessage.occurredAt,
        }
      : null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}
