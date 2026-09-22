import { Injectable } from '@nestjs/common';
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import type { CreateTaskDto, ListTasksQueryDto, UpdateTaskDto } from './dto/task.dto.js';
import { TaskNotFoundError, TaskRelationNotFoundError } from './tasks.errors.js';

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  completedAt: Date | null;
  ownerId: string | null;
  ownerName: string | null;
  leadId: string | null;
  leadName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TASK_INCLUDE = {
  owner: { select: { user: { select: { name: true } } } },
  lead: { select: { name: true } },
  deal: { select: { title: true } },
  customer: { select: { name: true } },
} satisfies Prisma.TaskInclude;

type PrismaTask = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly activities: ActivitiesService,
  ) {}

  async list(query: ListTasksQueryDto): Promise<PageResult<TaskView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.TaskWhereInput = { tenantId };

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.leadId) where.leadId = query.leadId;
    if (query.dealId) where.dealId = query.dealId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dueBefore || query.dueAfter) {
      where.dueAt = {
        ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
        ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
      };
    }

    const [total, tasks] = await this.prisma.$transaction([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: TASK_INCLUDE,
      }),
    ]);

    return buildPage(tasks.map(toTaskView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<TaskView> {
    const { tenantId } = this.tenantContext.requireContext();
    const task = await this.prisma.task.findFirst({ where: { id, tenantId }, include: TASK_INCLUDE });

    if (!task) {
      throw new TaskNotFoundError();
    }

    return toTaskView(task);
  }

  async create(dto: CreateTaskDto): Promise<TaskView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.validateRelations(tenantId, dto);

    const status = dto.status ?? TaskStatus.PENDING;
    const task = await this.prisma.task.create({
      data: {
        tenantId,
        title: dto.title.trim(),
        description: normalizeNullableString(dto.description),
        status,
        priority: dto.priority ?? TaskPriority.MEDIUM,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        ownerId: dto.ownerId ?? null,
        leadId: dto.leadId ?? null,
        dealId: dto.dealId ?? null,
        customerId: dto.customerId ?? null,
        completedAt: status === TaskStatus.DONE ? new Date() : null,
      },
      include: TASK_INCLUDE,
    });

    await this.activities.record({ entity: 'task', entityId: task.id, action: 'created' });

    return toTaskView(task);
  }

  async update(id: string, dto: UpdateTaskDto): Promise<TaskView> {
    const { tenantId } = this.tenantContext.requireContext();
    const existing = await this.prisma.task.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new TaskNotFoundError();
    }

    await this.validateRelations(tenantId, dto);

    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = normalizeNullableString(dto.description);
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueAt !== undefined) data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId;
    if (dto.leadId !== undefined) data.leadId = dto.leadId;
    if (dto.dealId !== undefined) data.dealId = dto.dealId;
    if (dto.customerId !== undefined) data.customerId = dto.customerId;
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.completedAt =
        dto.status === TaskStatus.DONE ? (existing.completedAt ?? new Date()) : null;
    }

    await this.prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });

    if (dto.status !== undefined && dto.status !== existing.status) {
      await this.activities.record({
        entity: 'task',
        entityId: id,
        action: 'status_changed',
        metadata: { from: existing.status, to: dto.status },
      });
    } else {
      await this.activities.record({ entity: 'task', entityId: id, action: 'updated' });
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.task.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new TaskNotFoundError();
    }
  }

  private async validateRelations(
    tenantId: string,
    refs: {
      ownerId?: string | null;
      leadId?: string | null;
      dealId?: string | null;
      customerId?: string | null;
    },
  ): Promise<void> {
    if (refs.ownerId) {
      const found = await this.prisma.tenantUser.findFirst({
        where: { id: refs.ownerId, tenantId, active: true },
        select: { id: true },
      });
      if (!found) throw new TaskRelationNotFoundError();
    }
    if (refs.leadId) {
      const found = await this.prisma.lead.findFirst({
        where: { id: refs.leadId, tenantId },
        select: { id: true },
      });
      if (!found) throw new TaskRelationNotFoundError();
    }
    if (refs.dealId) {
      const found = await this.prisma.deal.findFirst({
        where: { id: refs.dealId, tenantId },
        select: { id: true },
      });
      if (!found) throw new TaskRelationNotFoundError();
    }
    if (refs.customerId) {
      const found = await this.prisma.customer.findFirst({
        where: { id: refs.customerId, tenantId },
        select: { id: true },
      });
      if (!found) throw new TaskRelationNotFoundError();
    }
  }
}

function toTaskView(task: PrismaTask): TaskView {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    ownerId: task.ownerId,
    ownerName: task.owner?.user.name ?? null,
    leadId: task.leadId,
    leadName: task.lead?.name ?? null,
    dealId: task.dealId,
    dealTitle: task.deal?.title ?? null,
    customerId: task.customerId,
    customerName: task.customer?.name ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
