import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { ListActivitiesQueryDto } from './dto/activity.dto.js';

export interface ActivityView {
  id: string;
  userId: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

export interface RecordActivityInput {
  entity: string;
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async record(input: RecordActivityInput): Promise<void> {
    const { tenantId, userId } = this.tenantContext.requireContext();

    await this.prisma.activity.create({
      data: {
        tenantId,
        userId,
        entity: input.entity,
        entityId: input.entityId ?? null,
        action: input.action,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async list(query: ListActivitiesQueryDto): Promise<PageResult<ActivityView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.ActivityWhereInput = { tenantId };

    if (query.entity) {
      where.entity = query.entity;
    }
    if (query.entityId) {
      where.entityId = query.entityId;
    }
    if (query.action) {
      where.action = query.action;
    }

    const [total, activities] = await this.prisma.$transaction([
      this.prisma.activity.count({ where }),
      this.prisma.activity.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        select: {
          id: true,
          userId: true,
          entity: true,
          entityId: true,
          action: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);

    return buildPage(activities, total, query.page, query.perPage);
  }
}
