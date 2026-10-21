import { Injectable } from '@nestjs/common';
import { LeadRecommendationStatus, Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { ModuleDisabledError } from '../modules/modules.errors.js';
import { ModulesService } from '../modules/modules.service.js';
import { LeadNotFoundError } from '../leads/leads.errors.js';
import { ConversationNotFoundError } from '../conversations/conversations.errors.js';
import {
  AiSalesFollowUpInvalidStateError,
  AiSalesFollowUpNotFoundError,
  AiSalesFollowUpOwnerNotFoundError,
  AiSalesRecommendationInvalidStateError,
  AiSalesRecommendationNotFoundError,
} from './ai.errors.js';
import type {
  CreateSalesFollowUpDto,
  UpdateSalesFollowUpDto,
} from './dto/sales-copilot.dto.js';
import { FOLLOW_UP_INCLUDE, toFollowUpView } from './sales-copilot.mappers.js';
import type { SalesFollowUpView } from './sales-copilot.models.js';

@Injectable()
export class SalesFollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly modules: ModulesService,
  ) {}

  async create(dto: CreateSalesFollowUpDto): Promise<SalesFollowUpView> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();

    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, tenantId },
      select: { id: true, contactId: true, ownerId: true },
    });
    if (!lead) {
      throw new LeadNotFoundError();
    }

    const existingByKey = await this.prisma.leadFollowUp.findFirst({
      where: { tenantId, idempotencyKey: dto.idempotencyKey },
      include: FOLLOW_UP_INCLUDE,
    });
    if (existingByKey) {
      return toFollowUpView(existingByKey);
    }

    const recommendation = dto.recommendationId
      ? await this.prisma.leadRecommendation.findFirst({
          where: { id: dto.recommendationId, tenantId, leadId: lead.id },
        })
      : null;
    if (dto.recommendationId && !recommendation) {
      throw new AiSalesRecommendationNotFoundError();
    }

    if (recommendation) {
      if (
        recommendation.status !== LeadRecommendationStatus.RECOMMENDED &&
        recommendation.status !== LeadRecommendationStatus.ACCEPTED
      ) {
        throw new AiSalesRecommendationInvalidStateError();
      }
      const existingByRecommendation = await this.prisma.leadFollowUp.findFirst({
        where: { tenantId, recommendationId: recommendation.id },
        include: FOLLOW_UP_INCLUDE,
      });
      if (existingByRecommendation) {
        return toFollowUpView(existingByRecommendation);
      }
    }

    const conversationId = dto.conversationId ?? recommendation?.conversationId ?? null;
    if (conversationId) {
      if (!(await this.modules.isEnabled(tenantId, MODULE_KEYS.ATTENDANCE))) {
        throw new ModuleDisabledError(MODULE_KEYS.ATTENDANCE);
      }
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId, deletedAt: null },
        select: { id: true, contactId: true },
      });
      if (!conversation) {
        throw new ConversationNotFoundError();
      }
      if (!conversation.contactId || conversation.contactId !== lead.contactId) {
        throw new ConversationNotFoundError();
      }
    }

    const ownerId = dto.ownerId !== undefined ? dto.ownerId : (lead.ownerId ?? null);
    if (ownerId) {
      await this.requireActiveOwner(tenantId, ownerId);
    }

    const dueAt = dto.dueAt
      ? new Date(dto.dueAt)
      : (recommendation?.suggestedDueAt ?? null);
    const now = new Date();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const followUp = await tx.leadFollowUp.create({
          data: {
            tenantId,
            leadId: lead.id,
            conversationId,
            recommendationId: recommendation?.id ?? null,
            ownerId,
            createdByMembershipId: membershipId,
            idempotencyKey: dto.idempotencyKey,
            action: dto.action.trim(),
            reason: normalizeNullable(dto.reason),
            dueAt,
            suggestedMessage: normalizeNullable(dto.suggestedMessage),
            status: 'PENDING',
            events: [
              { type: 'CREATED', at: now.toISOString(), byMembershipId: membershipId },
            ] as Prisma.InputJsonValue,
          },
          include: FOLLOW_UP_INCLUDE,
        });

        if (recommendation) {
          await tx.leadRecommendation.update({
            where: { id: recommendation.id },
            data: {
              status: LeadRecommendationStatus.EXECUTED,
              decidedAt: now,
              decidedByMembershipId: membershipId,
              result: {
                followUpId: followUp.id,
                created: true,
              } satisfies Prisma.InputJsonObject,
            },
          });
        }

        return followUp;
      });

      return toFollowUpView(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.leadFollowUp.findFirst({
          where: {
            tenantId,
            OR: [
              { idempotencyKey: dto.idempotencyKey },
              ...(recommendation ? [{ recommendationId: recommendation.id }] : []),
            ],
          },
          include: FOLLOW_UP_INCLUDE,
        });
        if (raced) {
          return toFollowUpView(raced);
        }
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateSalesFollowUpDto): Promise<SalesFollowUpView> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id, tenantId },
    });
    if (!followUp) {
      throw new AiSalesFollowUpNotFoundError();
    }

    if (dto.ownerId) {
      await this.requireActiveOwner(tenantId, dto.ownerId);
    }

    const now = new Date();
    const data: Prisma.LeadFollowUpUpdateInput = {};
    const event: Record<string, unknown> = {
      at: now.toISOString(),
      byMembershipId: membershipId,
    };

    if (dto.status) {
      if (followUp.status !== 'PENDING') {
        if (followUp.status === dto.status) {
          return this.findView(tenantId, id);
        }
        throw new AiSalesFollowUpInvalidStateError();
      }
      data.status = dto.status;
      data.completedAt = dto.status === 'COMPLETED' ? now : null;
      data.canceledAt = dto.status === 'CANCELED' ? now : null;
      data.result = {
        outcome: normalizeNullable(dto.result),
      } satisfies Prisma.InputJsonObject;
      event.type = dto.status;
    }

    if (dto.dueAt) {
      if (followUp.status !== 'PENDING' || dto.status) {
        throw new AiSalesFollowUpInvalidStateError();
      }
      const nextDueAt = new Date(dto.dueAt);
      data.dueAt = nextDueAt;
      data.rescheduleCount = { increment: 1 };
      data.lastRescheduledAt = now;
      event.type = 'RESCHEDULED';
      event.from = followUp.dueAt?.toISOString() ?? null;
      event.to = nextDueAt.toISOString();
    }

    if (dto.ownerId !== undefined) {
      data.owner = dto.ownerId ? { connect: { id: dto.ownerId } } : { disconnect: true };
    }
    if (dto.reason !== undefined) {
      data.reason = normalizeNullable(dto.reason);
    }
    if (dto.suggestedMessage !== undefined) {
      data.suggestedMessage = normalizeNullable(dto.suggestedMessage);
    }

    if (event.type) {
      const events = Array.isArray(followUp.events) ? followUp.events : [];
      data.events = [...events, event] as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length === 0) {
      return this.findView(tenantId, id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leadFollowUp.update({
        where: { id },
        data,
        include: FOLLOW_UP_INCLUDE,
      });

      if (followUp.recommendationId && dto.status) {
        await tx.leadRecommendation.updateMany({
          where: { id: followUp.recommendationId, tenantId },
          data: {
            status:
              dto.status === 'COMPLETED'
                ? LeadRecommendationStatus.EXECUTED
                : LeadRecommendationStatus.CANCELED,
            decidedAt: now,
            decidedByMembershipId: membershipId,
            result: {
              followUpId: followUp.id,
              outcome: normalizeNullable(dto.result),
              status: dto.status,
            } satisfies Prisma.InputJsonObject,
          },
        });
      }

      return row;
    });

    return toFollowUpView(updated);
  }

  private async findView(tenantId: string, id: string): Promise<SalesFollowUpView> {
    const row = await this.prisma.leadFollowUp.findFirst({
      where: { id, tenantId },
      include: FOLLOW_UP_INCLUDE,
    });
    if (!row) {
      throw new AiSalesFollowUpNotFoundError();
    }
    return toFollowUpView(row);
  }

  private async requireActiveOwner(tenantId: string, ownerId: string): Promise<void> {
    const owner = await this.prisma.tenantUser.findFirst({
      where: { id: ownerId, tenantId, active: true },
      select: { id: true },
    });
    if (!owner) {
      throw new AiSalesFollowUpOwnerNotFoundError();
    }
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
