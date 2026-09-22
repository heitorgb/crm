import { Injectable } from '@nestjs/common';
import {
  AutomatedReviewOutcome,
  ConversationStatus,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  LeadStatus,
} from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { QualificationSessionsService } from '../qualification/qualification-sessions.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { ReviewNotResolvableError } from './compliance.errors.js';
import type { ResolveReviewDto } from './dto/compliance.dto.js';
import { PersonalDataService } from './personal-data.service.js';

@Injectable()
export class AutomatedReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly sessions: QualificationSessionsService,
    private readonly tickets: TicketsService,
    private readonly activities: ActivitiesService,
    private readonly personalData: PersonalDataService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Art. 20: opens an immediate human handoff instead of waiting for the next digest. */
  async requestReview(sessionId: string) {
    const { tenantId } = this.tenantContext.requireContext();
    const session = await this.sessions.requestReview(sessionId);

    await this.tickets.ensureHandoffTicket({
      tenantId,
      conversationId: await this.conversationIdForSession(tenantId, sessionId),
      leadId: session.leadId,
      customerId: null,
      reason: 'automated_review_requested',
    });

    await this.realtime.emitToTenant(tenantId, 'conversation.updated', {
      leadId: session.leadId,
      reason: 'automated_review_requested',
    });

    await this.personalData.record({
      type: DataSubjectRequestType.AUTOMATED_REVIEW,
      status: DataSubjectRequestStatus.PENDING,
      leadId: session.leadId,
      sessionId,
      details: { action: 'requested' },
    });

    return this.context(sessionId);
  }

  async resolveReview(sessionId: string, dto: ResolveReviewDto) {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const session = await this.prisma.leadQualificationSession.findFirst({
      where: { id: sessionId, tenantId },
    });

    if (!session || !session.reviewRequested) {
      throw new ReviewNotResolvableError();
    }

    const now = new Date();
    await this.prisma.leadQualificationSession.update({
      where: { id: sessionId },
      data: {
        reviewOutcome: dto.outcome,
        reviewNotes: dto.notes ?? null,
        reviewResolvedAt: now,
        reviewResolvedBy: membershipId,
      },
    });

    if (dto.outcome === AutomatedReviewOutcome.REVERSED) {
      await this.prisma.lead.update({
        where: { id: session.leadId },
        data: { status: LeadStatus.QUALIFIED_WAITING_DIGEST },
      });
    }

    await this.activities.record({
      entity: 'qualification_session',
      entityId: sessionId,
      action: 'review_resolved',
      metadata: { outcome: dto.outcome },
    });

    await this.personalData.record({
      type: DataSubjectRequestType.AUTOMATED_REVIEW,
      status: DataSubjectRequestStatus.COMPLETED,
      leadId: session.leadId,
      sessionId,
      details: { action: 'resolved' },
      response: { outcome: dto.outcome, notes: dto.notes ?? null },
    });

    return this.context(sessionId);
  }

  async context(sessionId: string) {
    const { tenantId } = this.tenantContext.requireContext();
    const session = await this.prisma.leadQualificationSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        lead: { select: { id: true, name: true, phone: true, status: true } },
        analyses: { orderBy: { createdAt: 'desc' }, take: 1 },
        profile: { select: { id: true, name: true, version: true } },
      },
    });

    if (!session) {
      throw new ReviewNotResolvableError();
    }

    const analysis = session.analyses[0] ?? null;

    return {
      session: {
        id: session.id,
        leadId: session.leadId,
        status: session.status,
        reviewRequested: session.reviewRequested,
        reviewRequestedAt: session.reviewRequestedAt,
        reviewOutcome: session.reviewOutcome,
        reviewNotes: session.reviewNotes,
        reviewResolvedAt: session.reviewResolvedAt,
        profileVersion: session.profileVersion,
      },
      lead: session.lead,
      analysis: analysis
        ? {
            id: analysis.id,
            outcome: analysis.outcome,
            score: analysis.score,
            qualificationLevel: analysis.qualificationLevel,
            summary: analysis.summary,
            qualificationReasons: analysis.qualificationReasons,
            provider: analysis.provider,
            model: analysis.model,
            createdAt: analysis.createdAt,
          }
        : null,
    };
  }

  private async conversationIdForSession(
    tenantId: string,
    sessionId: string,
  ): Promise<string | null> {
    const session = await this.prisma.leadQualificationSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { leadId: true },
    });
    if (!session) {
      return null;
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, leadId: session.leadId, status: { not: ConversationStatus.CLOSED } },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });

    return conversation?.id ?? null;
  }
}
