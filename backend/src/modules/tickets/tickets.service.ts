import { Injectable } from '@nestjs/common';
import { Prisma, TicketPriority, TicketStatus } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CreateTicketDto, ListTicketsQueryDto, UpdateTicketDto } from './dto/ticket.dto.js';
import { TicketNotFoundError } from './tickets.errors.js';

export interface TicketView {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  conversationId: string | null;
  leadId: string | null;
  leadName: string | null;
  customerId: string | null;
  customerName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TICKET_INCLUDE = {
  assignee: { select: { user: { select: { name: true } } } },
  lead: { select: { name: true } },
  customer: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type PrismaTicket = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(query: ListTicketsQueryDto): Promise<PageResult<TicketView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.TicketWhereInput = { tenantId };

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.unassigned) where.assigneeId = null;
    if (query.search) {
      where.subject = { contains: query.search, mode: 'insensitive' };
    }

    const [total, tickets] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: TICKET_INCLUDE,
      }),
    ]);

    return buildPage(tickets.map(toTicketView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<TicketView> {
    const { tenantId } = this.tenantContext.requireContext();
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, tenantId },
      include: TICKET_INCLUDE,
    });

    if (!ticket) {
      throw new TicketNotFoundError();
    }

    return toTicketView(ticket);
  }

  async create(dto: CreateTicketDto): Promise<TicketView> {
    const { tenantId } = this.tenantContext.requireContext();

    const ticket = await this.prisma.ticket.create({
      data: {
        tenantId,
        subject: dto.subject.trim(),
        conversationId: dto.conversationId ?? null,
        leadId: dto.leadId ?? null,
        customerId: dto.customerId ?? null,
        priority: dto.priority ?? TicketPriority.MEDIUM,
        assigneeId: dto.assigneeId ?? null,
      },
      include: TICKET_INCLUDE,
    });

    return toTicketView(ticket);
  }

  async update(id: string, dto: UpdateTicketDto): Promise<TicketView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireTicket(tenantId, id);

    const data: Prisma.TicketUncheckedUpdateInput = {};
    if (dto.subject !== undefined) data.subject = dto.subject.trim();
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId;
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.closedAt =
        dto.status === TicketStatus.CLOSED || dto.status === TicketStatus.RESOLVED
          ? new Date()
          : null;
    }

    const ticket = await this.prisma.ticket.update({ where: { id }, data, include: TICKET_INCLUDE });
    return toTicketView(ticket);
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.ticket.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new TicketNotFoundError();
    }
  }

  /**
   * System helper used by the bot handoff, where no authenticated tenant context exists.
   * Creates at most one open ticket per conversation.
   */
  async ensureHandoffTicket(input: {
    tenantId: string;
    conversationId: string | null;
    leadId: string | null;
    customerId: string | null;
    reason: string;
  }): Promise<void> {
    const existing = await this.prisma.ticket.findFirst({
      where: {
        tenantId: input.tenantId,
        status: { in: [TicketStatus.OPEN, TicketStatus.PENDING] },
        ...(input.conversationId
          ? { conversationId: input.conversationId }
          : { conversationId: null, leadId: input.leadId }),
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    await this.prisma.ticket.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        leadId: input.leadId,
        customerId: input.customerId,
        subject: `Handoff humano: ${input.reason}`,
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
      },
    });
  }

  private async requireTicket(tenantId: string, id: string): Promise<void> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }
  }
}

function toTicketView(ticket: PrismaTicket): TicketView {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    assigneeId: ticket.assigneeId,
    assigneeName: ticket.assignee?.user.name ?? null,
    conversationId: ticket.conversationId,
    leadId: ticket.leadId,
    leadName: ticket.lead?.name ?? null,
    customerId: ticket.customerId,
    customerName: ticket.customer?.name ?? null,
    openedAt: ticket.openedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}
