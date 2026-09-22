import { Injectable } from '@nestjs/common';
import { DealStatus, Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import type {
  CreateDealDto,
  DealBoardQueryDto,
  ListDealsQueryDto,
  MoveDealDto,
  UpdateDealDto,
} from './dto/deal.dto.js';
import {
  DealNotFoundError,
  DealPipelineEmptyError,
  DealPipelineNotFoundError,
  DealRelationNotFoundError,
  DealStageNotFoundError,
  DealStagePipelineMismatchError,
} from './deals.errors.js';

export interface DealView {
  id: string;
  title: string;
  description: string | null;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  value: string;
  currency: string;
  status: DealStatus;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  leadName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  expectedCloseAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DealBoardStageView {
  id: string;
  name: string;
  position: number;
  dealCount: number;
  deals: DealView[];
}

export interface DealBoardView {
  pipeline: { id: string; name: string };
  limitPerStage: number;
  stages: DealBoardStageView[];
}

const DEAL_INCLUDE = {
  pipeline: { select: { name: true } },
  stage: { select: { name: true } },
  customer: { select: { name: true } },
  contact: { select: { name: true } },
  lead: { select: { name: true } },
  owner: { select: { user: { select: { name: true } } } },
} satisfies Prisma.DealInclude;

type PrismaDeal = Prisma.DealGetPayload<{ include: typeof DEAL_INCLUDE }>;

const DEFAULT_BOARD_LIMIT = 25;
const MAX_BOARD_LIMIT = 100;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly activities: ActivitiesService,
  ) {}

  async list(query: ListDealsQueryDto): Promise<PageResult<DealView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.DealWhereInput = { tenantId };

    if (query.pipelineId) where.pipelineId = query.pipelineId;
    if (query.stageId) where.stageId = query.stageId;
    if (query.status) where.status = query.status;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.leadId) where.leadId = query.leadId;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, deals] = await this.prisma.$transaction([
      this.prisma.deal.count({ where }),
      this.prisma.deal.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: DEAL_INCLUDE,
      }),
    ]);

    return buildPage(deals.map(toDealView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<DealView> {
    const { tenantId } = this.tenantContext.requireContext();
    const deal = await this.prisma.deal.findFirst({ where: { id, tenantId }, include: DEAL_INCLUDE });

    if (!deal) {
      throw new DealNotFoundError();
    }

    return toDealView(deal);
  }

  async create(dto: CreateDealDto): Promise<DealView> {
    const { tenantId } = this.tenantContext.requireContext();

    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: dto.pipelineId, tenantId },
      select: { id: true },
    });
    if (!pipeline) {
      throw new DealPipelineNotFoundError();
    }

    const stage = await this.resolveStage(tenantId, pipeline.id, dto.stageId);
    await this.validateRelations(tenantId, dto);

    const status = dto.status ?? DealStatus.OPEN;
    const deal = await this.prisma.deal.create({
      data: {
        tenantId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: dto.title.trim(),
        description: normalizeNullableString(dto.description),
        value: dto.value ?? 0,
        currency: dto.currency ?? 'BRL',
        status,
        customerId: dto.customerId ?? null,
        contactId: dto.contactId ?? null,
        leadId: dto.leadId ?? null,
        ownerId: dto.ownerId ?? null,
        expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null,
        closedAt: isClosed(status) ? new Date() : null,
      },
      include: DEAL_INCLUDE,
    });

    await this.activities.record({
      entity: 'deal',
      entityId: deal.id,
      action: 'created',
      metadata: { pipelineId: pipeline.id, stageId: stage.id },
    });

    return toDealView(deal);
  }

  async update(id: string, dto: UpdateDealDto): Promise<DealView> {
    const { tenantId } = this.tenantContext.requireContext();
    const existing = await this.prisma.deal.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new DealNotFoundError();
    }

    await this.validateRelations(tenantId, {
      customerId: dto.customerId ?? undefined,
      contactId: dto.contactId ?? undefined,
      leadId: dto.leadId ?? undefined,
      ownerId: dto.ownerId ?? undefined,
    });

    const data: Prisma.DealUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = normalizeNullableString(dto.description);
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.customerId !== undefined) data.customerId = dto.customerId;
    if (dto.contactId !== undefined) data.contactId = dto.contactId;
    if (dto.leadId !== undefined) data.leadId = dto.leadId;
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId;
    if (dto.expectedCloseAt !== undefined) {
      data.expectedCloseAt = dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.closedAt = isClosed(dto.status) ? (existing.closedAt ?? new Date()) : null;
    }

    await this.prisma.deal.update({ where: { id }, data, include: DEAL_INCLUDE });

    if (dto.status !== undefined && dto.status !== existing.status) {
      await this.activities.record({
        entity: 'deal',
        entityId: id,
        action: 'status_changed',
        metadata: { from: existing.status, to: dto.status },
      });
    } else {
      await this.activities.record({ entity: 'deal', entityId: id, action: 'updated' });
    }

    return this.findOne(id);
  }

  async move(id: string, dto: MoveDealDto): Promise<DealView> {
    const { tenantId } = this.tenantContext.requireContext();
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId },
      include: { stage: { select: { name: true } } },
    });
    if (!deal) {
      throw new DealNotFoundError();
    }

    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: dto.stageId, tenantId },
      select: { id: true, name: true, pipelineId: true },
    });
    if (!stage) {
      throw new DealStageNotFoundError();
    }
    if (stage.pipelineId !== deal.pipelineId) {
      throw new DealStagePipelineMismatchError();
    }
    if (stage.id === deal.stageId) {
      return this.findOne(id);
    }

    const updated = await this.prisma.deal.update({
      where: { id },
      data: { stageId: stage.id },
      include: DEAL_INCLUDE,
    });

    await this.activities.record({
      entity: 'deal',
      entityId: id,
      action: 'stage_moved',
      metadata: {
        fromStageId: deal.stageId,
        fromStageName: deal.stage.name,
        toStageId: stage.id,
        toStageName: stage.name,
      },
    });

    return toDealView(updated);
  }

  async board(query: DealBoardQueryDto): Promise<DealBoardView> {
    const { tenantId } = this.tenantContext.requireContext();
    const limitPerStage = Math.min(query.limitPerStage ?? DEFAULT_BOARD_LIMIT, MAX_BOARD_LIMIT);

    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: query.pipelineId, tenantId },
      select: { id: true, name: true },
    });
    if (!pipeline) {
      throw new DealPipelineNotFoundError();
    }

    const stages = await this.prisma.pipelineStage.findMany({
      where: { tenantId, pipelineId: pipeline.id },
      orderBy: { position: 'asc' },
      take: 200,
      include: { _count: { select: { deals: true } } },
    });

    const stageDeals = await Promise.all(
      stages.map((stage) =>
        this.prisma.deal.findMany({
          where: { tenantId, stageId: stage.id },
          orderBy: { createdAt: 'desc' },
          take: limitPerStage,
          include: DEAL_INCLUDE,
        }),
      ),
    );

    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      limitPerStage,
      stages: stages.map((stage, index) => ({
        id: stage.id,
        name: stage.name,
        position: stage.position,
        dealCount: stage._count.deals,
        deals: stageDeals[index].map(toDealView),
      })),
    };
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.deal.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new DealNotFoundError();
    }
  }

  private async resolveStage(tenantId: string, pipelineId: string, stageId?: string) {
    if (stageId) {
      const stage = await this.prisma.pipelineStage.findFirst({
        where: { id: stageId, tenantId },
        select: { id: true, pipelineId: true },
      });
      if (!stage) {
        throw new DealStageNotFoundError();
      }
      if (stage.pipelineId !== pipelineId) {
        throw new DealStagePipelineMismatchError();
      }
      return stage;
    }

    const firstStage = await this.prisma.pipelineStage.findFirst({
      where: { tenantId, pipelineId },
      orderBy: { position: 'asc' },
      select: { id: true, pipelineId: true },
    });
    if (!firstStage) {
      throw new DealPipelineEmptyError();
    }
    return firstStage;
  }

  private async validateRelations(
    tenantId: string,
    refs: {
      customerId?: string;
      contactId?: string;
      leadId?: string;
      ownerId?: string;
    },
  ): Promise<void> {
    if (refs.customerId) {
      const found = await this.prisma.customer.findFirst({
        where: { id: refs.customerId, tenantId },
        select: { id: true },
      });
      if (!found) throw new DealRelationNotFoundError();
    }
    if (refs.contactId) {
      const found = await this.prisma.contact.findFirst({
        where: { id: refs.contactId, tenantId },
        select: { id: true },
      });
      if (!found) throw new DealRelationNotFoundError();
    }
    if (refs.leadId) {
      const found = await this.prisma.lead.findFirst({
        where: { id: refs.leadId, tenantId },
        select: { id: true },
      });
      if (!found) throw new DealRelationNotFoundError();
    }
    if (refs.ownerId) {
      const found = await this.prisma.tenantUser.findFirst({
        where: { id: refs.ownerId, tenantId, active: true },
        select: { id: true },
      });
      if (!found) throw new DealRelationNotFoundError();
    }
  }
}

function isClosed(status: DealStatus): boolean {
  return status === DealStatus.WON || status === DealStatus.LOST;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDealView(deal: PrismaDeal): DealView {
  return {
    id: deal.id,
    title: deal.title,
    description: deal.description,
    pipelineId: deal.pipelineId,
    pipelineName: deal.pipeline.name,
    stageId: deal.stageId,
    stageName: deal.stage.name,
    value: deal.value.toString(),
    currency: deal.currency,
    status: deal.status,
    customerId: deal.customerId,
    customerName: deal.customer?.name ?? null,
    contactId: deal.contactId,
    contactName: deal.contact?.name ?? null,
    leadId: deal.leadId,
    leadName: deal.lead?.name ?? null,
    ownerId: deal.ownerId,
    ownerName: deal.owner?.user.name ?? null,
    expectedCloseAt: deal.expectedCloseAt,
    closedAt: deal.closedAt,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
  };
}
