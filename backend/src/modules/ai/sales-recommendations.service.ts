import { Injectable } from '@nestjs/common';
import {
  LeadRecommendationKind,
  LeadRecommendationStatus,
  LeadStageKind,
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  AiSalesLeadUpdateTooLargeError,
  AiSalesRecommendationInvalidStageError,
  AiSalesRecommendationInvalidStateError,
  AiSalesRecommendationNotFoundError,
} from './ai.errors.js';
import type { UpdateSalesRecommendationDto } from './dto/sales-copilot.dto.js';
import { RECOMMENDATION_INCLUDE, toRecommendationView } from './sales-copilot.mappers.js';
import { SALES_MAX_LEAD_NOTES_CHARS } from './sales-copilot.models.js';

const UPDATE_FIELD_LABELS: Record<string, string> = {
  NEED: 'necessidade',
  PRODUCT: 'produto ou serviço de interesse',
  BUDGET: 'orçamento informado',
  DEADLINE: 'prazo desejado',
  USERS: 'número de usuários ou volume',
  REQUIREMENTS: 'requisitos técnicos',
  OBJECTION: 'objeção',
  STAGE: 'etapa do pipeline',
  LOSS_REASON: 'motivo de perda',
  NOTES: 'observação comercial',
};

@Injectable()
export class SalesRecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async decide(recommendationId: string, dto: UpdateSalesRecommendationDto) {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const recommendation = await this.prisma.leadRecommendation.findFirst({
      where: { id: recommendationId, tenantId },
    });
    if (!recommendation) {
      throw new AiSalesRecommendationNotFoundError();
    }

    if (dto.action === 'REJECT') {
      return this.reject(tenantId, membershipId, recommendation, dto.value);
    }
    if (dto.action === 'CANCEL') {
      return this.cancel(tenantId, membershipId, recommendation, dto.value);
    }
    if (recommendation.kind === LeadRecommendationKind.NEXT_ACTION) {
      return this.acceptNextAction(tenantId, membershipId, recommendation);
    }
    return this.acceptLeadUpdate(tenantId, membershipId, recommendation, dto.value);
  }

  private async reject(
    tenantId: string,
    membershipId: string,
    recommendation: { id: string; status: LeadRecommendationStatus },
    value: string | undefined,
  ) {
    if (recommendation.status === LeadRecommendationStatus.REJECTED) {
      return this.findView(tenantId, recommendation.id);
    }
    if (recommendation.status !== LeadRecommendationStatus.RECOMMENDED) {
      throw new AiSalesRecommendationInvalidStateError();
    }

    const row = await this.prisma.leadRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: LeadRecommendationStatus.REJECTED,
        decidedAt: new Date(),
        decidedByMembershipId: membershipId,
        result: { reason: value ?? null } satisfies Prisma.InputJsonObject,
      },
      include: RECOMMENDATION_INCLUDE,
    });
    return toRecommendationView(row);
  }

  private async cancel(
    tenantId: string,
    membershipId: string,
    recommendation: { id: string; status: LeadRecommendationStatus },
    value: string | undefined,
  ) {
    if (recommendation.status === LeadRecommendationStatus.CANCELED) {
      return this.findView(tenantId, recommendation.id);
    }
    if (
      recommendation.status !== LeadRecommendationStatus.RECOMMENDED &&
      recommendation.status !== LeadRecommendationStatus.ACCEPTED
    ) {
      throw new AiSalesRecommendationInvalidStateError();
    }

    const row = await this.prisma.leadRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: LeadRecommendationStatus.CANCELED,
        decidedAt: new Date(),
        decidedByMembershipId: membershipId,
        result: { reason: value ?? null } satisfies Prisma.InputJsonObject,
      },
      include: RECOMMENDATION_INCLUDE,
    });
    return toRecommendationView(row);
  }

  private async acceptNextAction(
    tenantId: string,
    membershipId: string,
    recommendation: {
      id: string;
      status: LeadRecommendationStatus;
    },
  ) {
    if (
      recommendation.status === LeadRecommendationStatus.ACCEPTED ||
      recommendation.status === LeadRecommendationStatus.EXECUTED
    ) {
      return this.findView(tenantId, recommendation.id);
    }
    if (recommendation.status !== LeadRecommendationStatus.RECOMMENDED) {
      throw new AiSalesRecommendationInvalidStateError();
    }

    const row = await this.prisma.leadRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: LeadRecommendationStatus.ACCEPTED,
        decidedAt: new Date(),
        decidedByMembershipId: membershipId,
        result: { accepted: true } satisfies Prisma.InputJsonObject,
      },
      include: RECOMMENDATION_INCLUDE,
    });
    return toRecommendationView(row);
  }

  private async acceptLeadUpdate(
    tenantId: string,
    membershipId: string,
    recommendation: {
      id: string;
      leadId: string;
      status: LeadRecommendationStatus;
      updateField: string | null;
      proposedValue: string | null;
    },
    editedValue: string | undefined,
  ) {
    if (recommendation.status === LeadRecommendationStatus.EXECUTED) {
      return this.findView(tenantId, recommendation.id);
    }
    if (recommendation.status !== LeadRecommendationStatus.RECOMMENDED) {
      throw new AiSalesRecommendationInvalidStateError();
    }
    const updateField = recommendation.updateField;
    if (!updateField) {
      throw new AppException(
        'AI_SALES_LEAD_UPDATE_INVALID',
        'A recomendação não contém um campo válido para atualização.',
        400,
      );
    }

    const value = (editedValue ?? recommendation.proposedValue ?? '').trim();
    if (value.length === 0) {
      throw new AppException(
        'AI_SALES_LEAD_UPDATE_INVALID',
        'Informe um valor para aplicar a atualização.',
        400,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: recommendation.leadId, tenantId },
        select: {
          id: true,
          pipelineId: true,
          stageId: true,
          status: true,
          notes: true,
          closedAt: true,
        },
      });
      if (!lead) {
        throw new AppException('LEAD_NOT_FOUND', 'Lead não encontrado', 404);
      }

      const beforeData: Prisma.InputJsonObject = {
        stageId: lead.stageId,
        status: lead.status,
        notes: lead.notes,
      };
      let afterData: Prisma.InputJsonObject;

      if (updateField === 'STAGE') {
        const stage = await tx.leadStage.findFirst({
          where: {
            tenantId,
            pipelineId: lead.pipelineId,
            name: { equals: value, mode: 'insensitive' },
          },
          select: { id: true, kind: true },
        });
        if (!stage) {
          throw new AiSalesRecommendationInvalidStageError();
        }

        const status = statusForKind(stage.kind);
        const closedAt = status === LeadStatus.OPEN ? null : (lead.closedAt ?? new Date());
        await tx.lead.update({
          where: { id: lead.id },
          data: { stageId: stage.id, status, closedAt },
        });
        afterData = { stageId: stage.id, status };
      } else {
        const label = UPDATE_FIELD_LABELS[updateField] ?? 'informação';
        const line = `[Copiloto IA · ${label} · ${new Date().toISOString().slice(0, 10)}] ${value}`;
        const nextNotes = lead.notes?.trim() ? `${lead.notes.trim()}\n\n${line}` : line;
        if (nextNotes.length > SALES_MAX_LEAD_NOTES_CHARS) {
          throw new AiSalesLeadUpdateTooLargeError();
        }
        await tx.lead.update({
          where: { id: lead.id },
          data: { notes: nextNotes },
        });
        afterData = { notes: nextNotes };
      }

      const row = await tx.leadRecommendation.update({
        where: { id: recommendation.id },
        data: {
          status: LeadRecommendationStatus.EXECUTED,
          decidedAt: new Date(),
          decidedByMembershipId: membershipId,
          beforeData,
          afterData,
          result: {
            applied: true,
            field: updateField,
            value,
          } satisfies Prisma.InputJsonObject,
        },
        include: RECOMMENDATION_INCLUDE,
      });

      return toRecommendationView(row);
    });
  }

  private async findView(tenantId: string, recommendationId: string) {
    const row = await this.prisma.leadRecommendation.findFirst({
      where: { id: recommendationId, tenantId },
      include: RECOMMENDATION_INCLUDE,
    });
    if (!row) {
      throw new AiSalesRecommendationNotFoundError();
    }
    return toRecommendationView(row);
  }
}

function statusForKind(kind: LeadStageKind): LeadStatus {
  if (kind === LeadStageKind.WON) return LeadStatus.WON;
  if (kind === LeadStageKind.LOST) return LeadStatus.LOST;
  return LeadStatus.OPEN;
}
