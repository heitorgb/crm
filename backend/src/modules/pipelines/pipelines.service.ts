import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  CreatePipelineDto,
  CreatePipelineStageDto,
  ListPipelinesQueryDto,
  UpdatePipelineDto,
  UpdatePipelineStageDto,
} from './dto/pipeline.dto.js';
import {
  PipelineInUseError,
  PipelineNameConflictError,
  PipelineNotFoundError,
  PipelineStageNotFoundError,
  PipelineStagePositionConflictError,
} from './pipelines.errors.js';

export interface PipelineStageView {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  dealCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineView {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  stageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineDetailView extends Omit<PipelineView, 'stageCount'> {
  stages: PipelineStageView[];
}

@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(query: ListPipelinesQueryDto): Promise<PageResult<PipelineView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.PipelineWhereInput = { tenantId };

    if (query.active !== undefined) {
      where.active = query.active;
    }
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [total, pipelines] = await this.prisma.$transaction([
      this.prisma.pipeline.count({ where }),
      this.prisma.pipeline.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: { _count: { select: { stages: true } } },
      }),
    ]);

    return buildPage(pipelines.map(toPipelineView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<PipelineDetailView> {
    const { tenantId } = this.tenantContext.requireContext();
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, tenantId },
      include: {
        stages: {
          orderBy: { position: 'asc' },
          include: { _count: { select: { deals: true } } },
        },
      },
    });

    if (!pipeline) {
      throw new PipelineNotFoundError();
    }

    return {
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      active: pipeline.active,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
      stages: pipeline.stages.map(toStageView),
    };
  }

  async create(dto: CreatePipelineDto): Promise<PipelineDetailView> {
    const { tenantId } = this.tenantContext.requireContext();

    try {
      const pipeline = await this.prisma.pipeline.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          description: normalizeNullableString(dto.description),
          active: dto.active ?? true,
        },
      });
      return this.findOne(pipeline.id);
    } catch (error) {
      throw mapPipelineConflict(error);
    }
  }

  async update(id: string, dto: UpdatePipelineDto): Promise<PipelineDetailView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requirePipeline(tenantId, id);

    const data: Prisma.PipelineUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = normalizeNullableString(dto.description);
    if (dto.active !== undefined) data.active = dto.active;

    try {
      await this.prisma.pipeline.update({ where: { id }, data });
    } catch (error) {
      throw mapPipelineConflict(error);
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();

    try {
      const result = await this.prisma.pipeline.deleteMany({ where: { id, tenantId } });
      if (result.count === 0) {
        throw new PipelineNotFoundError();
      }
    } catch (error) {
      throw mapPipelineConflict(error);
    }
  }

  async listStages(pipelineId: string): Promise<PipelineStageView[]> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requirePipeline(tenantId, pipelineId);

    const stages = await this.prisma.pipelineStage.findMany({
      where: { tenantId, pipelineId },
      orderBy: { position: 'asc' },
      take: 200,
      include: { _count: { select: { deals: true } } },
    });

    return stages.map(toStageView);
  }

  async createStage(pipelineId: string, dto: CreatePipelineStageDto): Promise<PipelineStageView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requirePipeline(tenantId, pipelineId);

    let position = dto.position;
    if (position === undefined) {
      const last = await this.prisma.pipelineStage.findFirst({
        where: { pipelineId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      position = (last?.position ?? -1) + 1;
    }

    try {
      const stage = await this.prisma.pipelineStage.create({
        data: { tenantId, pipelineId, name: dto.name.trim(), position },
        include: { _count: { select: { deals: true } } },
      });
      return toStageView(stage);
    } catch (error) {
      throw mapStageConflict(error);
    }
  }

  async updateStage(
    pipelineId: string,
    stageId: string,
    dto: UpdatePipelineStageDto,
  ): Promise<PipelineStageView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireStage(tenantId, pipelineId, stageId);

    const data: Prisma.PipelineStageUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.position !== undefined) data.position = dto.position;

    try {
      const stage = await this.prisma.pipelineStage.update({
        where: { id: stageId },
        data,
        include: { _count: { select: { deals: true } } },
      });
      return toStageView(stage);
    } catch (error) {
      throw mapStageConflict(error);
    }
  }

  async removeStage(pipelineId: string, stageId: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();

    try {
      const result = await this.prisma.pipelineStage.deleteMany({
        where: { id: stageId, pipelineId, tenantId },
      });
      if (result.count === 0) {
        throw new PipelineStageNotFoundError();
      }
    } catch (error) {
      throw mapStageConflict(error);
    }
  }

  private async requirePipeline(tenantId: string, id: string): Promise<void> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!pipeline) {
      throw new PipelineNotFoundError();
    }
  }

  private async requireStage(tenantId: string, pipelineId: string, stageId: string): Promise<void> {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId, tenantId },
      select: { id: true },
    });
    if (!stage) {
      throw new PipelineStageNotFoundError();
    }
  }
}

type StageWithCount = Prisma.PipelineStageGetPayload<{
  include: { _count: { select: { deals: true } } };
}>;

function toStageView(stage: StageWithCount): PipelineStageView {
  return {
    id: stage.id,
    pipelineId: stage.pipelineId,
    name: stage.name,
    position: stage.position,
    dealCount: stage._count.deals,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

type PipelineWithCount = Prisma.PipelineGetPayload<{
  include: { _count: { select: { stages: true } } };
}>;

function toPipelineView(pipeline: PipelineWithCount): PipelineView {
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    active: pipeline.active,
    stageCount: pipeline._count.stages,
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt,
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapPipelineConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new PipelineNameConflictError();
    if (error.code === 'P2003') return new PipelineInUseError();
  }
  return error;
}

function mapStageConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new PipelineStagePositionConflictError();
    if (error.code === 'P2003') return new PipelineInUseError();
  }
  return error;
}
