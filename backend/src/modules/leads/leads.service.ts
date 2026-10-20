import { Injectable } from '@nestjs/common';
import { LeadStageKind, LeadStatus, Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  CreateLeadDto,
  CreatePipelineDto,
  CreateStageDto,
  LeadBoardQueryDto,
  UpdateLeadDto,
  UpdatePipelineDto,
  UpdateStageDto,
} from './dto/lead.dto.js';
import {
  LeadNotFoundError,
  LeadPipelineNotFoundError,
  LeadStageInUseError,
  LeadStageNotFoundError,
} from './leads.errors.js';

const LEAD_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true, email: true, avatarUrl: true } },
  owner: { select: { id: true, user: { select: { name: true } } } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.LeadInclude;

type StoredLead = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listPipelines() {
    const { tenantId } = this.tenantContext.requireContext();
    return this.prisma.leadPipeline.findMany({
      where: { tenantId },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      include: { stages: { orderBy: { position: 'asc' } } },
    });
  }

  async createPipeline(dto: CreatePipelineDto) {
    const { tenantId } = this.tenantContext.requireContext();
    return this.prisma.leadPipeline.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        description: normalizeNullable(dto.description),
        stages: {
          create: [
            { tenantId, name: 'Novo lead', color: '#3b82f6', position: 1 },
            { tenantId, name: 'Entrou em contato', color: '#06b6d4', position: 2 },
            { tenantId, name: 'Venda ganha', color: '#22c55e', position: 3, kind: 'WON' },
            { tenantId, name: 'Perdido', color: '#ef4444', position: 4, kind: 'LOST' },
          ],
        },
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
  }

  async updatePipeline(id: string, dto: UpdatePipelineDto) {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requirePipeline(tenantId, id);
    return this.prisma.leadPipeline.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: normalizeNullable(dto.description) }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
  }

  async createStage(pipelineId: string, dto: CreateStageDto) {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requirePipeline(tenantId, pipelineId);
    const aggregate = await this.prisma.leadStage.aggregate({
      where: { tenantId, pipelineId },
      _max: { position: true },
    });
    return this.prisma.leadStage.create({
      data: {
        tenantId,
        pipelineId,
        name: dto.name.trim(),
        color: normalizeNullable(dto.color),
        kind: dto.kind ?? LeadStageKind.OPEN,
        position: (aggregate._max.position ?? 0) + 1,
      },
    });
  }

  async updateStage(pipelineId: string, stageId: string, dto: UpdateStageDto) {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireStage(tenantId, pipelineId, stageId);
    return this.prisma.leadStage.update({
      where: { id: stageId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.color !== undefined ? { color: normalizeNullable(dto.color) } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      },
    });
  }

  async removeStage(pipelineId: string, stageId: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireStage(tenantId, pipelineId, stageId);
    const leadCount = await this.prisma.lead.count({ where: { tenantId, stageId } });
    if (leadCount > 0) throw new LeadStageInUseError();
    await this.prisma.leadStage.delete({ where: { id: stageId } });
  }

  async board(query: LeadBoardQueryDto) {
    const { tenantId } = this.tenantContext.requireContext();
    const pipeline = query.pipelineId
      ? await this.prisma.leadPipeline.findFirst({ where: { id: query.pipelineId, tenantId } })
      : await this.prisma.leadPipeline.findFirst({
          where: { tenantId, active: true },
          orderBy: { createdAt: 'asc' },
        });
    if (!pipeline) throw new LeadPipelineNotFoundError();

    const leadWhere: Prisma.LeadWhereInput = {
      tenantId,
      pipelineId: pipeline.id,
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { source: { contains: query.search, mode: 'insensitive' } },
              { contact: { name: { contains: query.search, mode: 'insensitive' } } },
              { contact: { phone: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [stages, aggregates] = await this.prisma.$transaction([
      this.prisma.leadStage.findMany({
        where: { tenantId, pipelineId: pipeline.id },
        orderBy: { position: 'asc' },
        include: {
          leads: {
            where: leadWhere,
            orderBy: { updatedAt: 'desc' },
            take: query.limitPerStage,
            include: LEAD_INCLUDE,
          },
        },
      }),
      this.prisma.lead.groupBy({
        by: ['stageId'],
        where: leadWhere,
        _count: { _all: true },
        _sum: { valueCents: true },
      }),
    ]);

    const aggregateByStage = new Map(aggregates.map((item) => [item.stageId, item]));
    return {
      pipeline,
      stages: stages.map((stage) => {
        const aggregate = aggregateByStage.get(stage.id);
        return {
          id: stage.id,
          name: stage.name,
          color: stage.color,
          position: stage.position,
          kind: stage.kind,
          leadCount: aggregate?._count._all ?? 0,
          valueCents: aggregate?._sum.valueCents ?? 0,
          leads: stage.leads.map(toLeadView),
        };
      }),
    };
  }

  async create(dto: CreateLeadDto) {
    const { tenantId } = this.tenantContext.requireContext();
    const stage = await this.validateRelations(tenantId, dto.pipelineId, dto.stageId, dto.contactId, dto.ownerId);
    const tagIds = await this.validateTagIds(tenantId, dto.tagIds);
    const lead = await this.prisma.lead.create({
      data: {
        tenantId,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        contactId: dto.contactId,
        ownerId: dto.ownerId ?? null,
        title: dto.title.trim(),
        source: normalizeNullable(dto.source),
        valueCents: dto.valueCents ?? 0,
        status: statusForKind(stage.kind),
        notes: normalizeNullable(dto.notes),
        nextFollowUpAt: parseNullableDate(dto.nextFollowUpAt),
        closedAt: stage.kind === LeadStageKind.OPEN ? null : new Date(),
        tags: { create: tagIds.map((tagId) => ({ tenantId, tagId })) },
      },
      include: LEAD_INCLUDE,
    });
    return toLeadView(lead);
  }

  async update(id: string, dto: UpdateLeadDto) {
    const { tenantId } = this.tenantContext.requireContext();
    const current = await this.prisma.lead.findFirst({ where: { id, tenantId } });
    if (!current) throw new LeadNotFoundError();

    const stageId = dto.stageId ?? current.stageId;
    const contactId = dto.contactId ?? current.contactId;
    const stage = await this.validateRelations(
      tenantId,
      current.pipelineId,
      stageId,
      contactId,
      dto.ownerId === undefined ? current.ownerId : dto.ownerId,
    );
    const status = statusForKind(stage.kind);
    const tagIds = dto.tagIds === undefined ? undefined : await this.validateTagIds(tenantId, dto.tagIds);
    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        stageId,
        contactId,
        ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.source !== undefined ? { source: normalizeNullable(dto.source) } : {}),
        ...(dto.valueCents !== undefined ? { valueCents: dto.valueCents } : {}),
        ...(dto.notes !== undefined ? { notes: normalizeNullable(dto.notes) } : {}),
        ...(dto.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: parseNullableDate(dto.nextFollowUpAt) }
          : {}),
        status,
        closedAt: status === LeadStatus.OPEN ? null : current.closedAt ?? new Date(),
        ...(tagIds !== undefined
          ? { tags: { deleteMany: { tenantId }, create: tagIds.map((tagId) => ({ tenantId, tagId })) } }
          : {}),
      },
      include: LEAD_INCLUDE,
    });
    return toLeadView(lead);
  }

  async move(id: string, stageId: string) {
    return this.update(id, { stageId });
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.lead.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) throw new LeadNotFoundError();
  }

  private async validateRelations(
    tenantId: string,
    pipelineId: string,
    stageId: string,
    contactId: string,
    ownerId?: string | null,
  ) {
    const [stage, contact, owner] = await Promise.all([
      this.prisma.leadStage.findFirst({ where: { id: stageId, tenantId, pipelineId } }),
      this.prisma.contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true } }),
      ownerId
        ? this.prisma.tenantUser.findFirst({ where: { id: ownerId, tenantId, active: true }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (!stage) throw new LeadStageNotFoundError();
    if (!contact) throw new AppException('LEAD_CONTACT_NOT_FOUND', 'Contato não encontrado', 404);
    if (ownerId && !owner) throw new AppException('LEAD_OWNER_NOT_FOUND', 'Responsável não encontrado', 404);
    return stage;
  }

  private async validateTagIds(tenantId: string, input: string[] | undefined): Promise<string[]> {
    const tagIds = [...new Set(input ?? [])];
    if (tagIds.length === 0) return tagIds;
    const count = await this.prisma.tag.count({ where: { tenantId, id: { in: tagIds } } });
    if (count !== tagIds.length) {
      throw new AppException('LEAD_TAG_NOT_FOUND', 'Etiqueta nÃ£o encontrada', 404);
    }
    return tagIds;
  }

  private async requirePipeline(tenantId: string, id: string): Promise<void> {
    const pipeline = await this.prisma.leadPipeline.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!pipeline) throw new LeadPipelineNotFoundError();
  }

  private async requireStage(tenantId: string, pipelineId: string, stageId: string): Promise<void> {
    const stage = await this.prisma.leadStage.findFirst({ where: { id: stageId, pipelineId, tenantId }, select: { id: true } });
    if (!stage) throw new LeadStageNotFoundError();
  }
}

function toLeadView(lead: StoredLead) {
  return {
    id: lead.id,
    pipelineId: lead.pipelineId,
    stageId: lead.stageId,
    contactId: lead.contactId,
    ownerId: lead.ownerId,
    ownerName: lead.owner?.user.name ?? null,
    title: lead.title,
    source: lead.source,
    valueCents: lead.valueCents,
    status: lead.status,
    notes: lead.notes,
    nextFollowUpAt: lead.nextFollowUpAt,
    closedAt: lead.closedAt,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    contact: lead.contact,
    tags: lead.tags.map(({ tag }) => tag),
  };
}

function statusForKind(kind: LeadStageKind): LeadStatus {
  if (kind === LeadStageKind.WON) return LeadStatus.WON;
  if (kind === LeadStageKind.LOST) return LeadStatus.LOST;
  return LeadStatus.OPEN;
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNullableDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}
