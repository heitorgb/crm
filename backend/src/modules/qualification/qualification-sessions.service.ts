import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  QualificationOutcome,
  QualificationSessionStatus,
} from '@prisma/client';
import type { QualificationProfile } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { AI_PROVIDER } from './ai/ai-provider.types.js';
import type {
  AiConversationEntry,
  AiCriterionItem,
  AiListItem,
  AiProfileConfig,
  AiProvider,
  AiRequiredInformationItem,
} from './ai/ai-provider.types.js';
import type {
  EvaluateQualificationMessageDto,
  ListLeadAnalysesQueryDto,
  ListQualificationSessionsQueryDto,
  StartQualificationSessionDto,
} from './dto/qualification.dto.js';
import type { EngineDecision } from './qualification-engine.service.js';
import { QualificationEngineService } from './qualification-engine.service.js';
import {
  QualificationAnalysisNotFoundError,
  QualificationLeadNotFoundError,
  QualificationProfileUnavailableError,
  QualificationSessionNotActiveError,
  QualificationSessionNotCompletedError,
  QualificationSessionNotFoundError,
} from './qualification.errors.js';

export interface QualificationSessionView {
  id: string;
  leadId: string;
  profileId: string;
  profileVersion: number;
  status: QualificationSessionStatus;
  collectedData: Prisma.JsonValue;
  missingInformation: Prisma.JsonValue;
  transcript: AiConversationEntry[];
  questionCount: number;
  reviewRequested: boolean;
  reviewRequestedAt: Date | null;
  handoffReason: string | null;
  startedAt: Date;
  lastInteractionAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadAnalysisView {
  id: string;
  leadId: string;
  sessionId: string;
  profileId: string;
  profileVersion: number;
  provider: string;
  model: string;
  outcome: QualificationOutcome;
  score: number | null;
  qualificationLevel: string | null;
  summary: string;
  collectedData: Prisma.JsonValue;
  strengths: Prisma.JsonValue;
  risks: Prisma.JsonValue;
  missingInformation: Prisma.JsonValue;
  recommendedNextStep: string | null;
  qualificationReasons: Prisma.JsonValue;
  createdAt: Date;
  completedAt: Date;
}

export interface EvaluateSessionResult {
  session: QualificationSessionView;
  analysis: LeadAnalysisView | null;
  decision: EngineDecision;
}

type SessionRecord = Prisma.LeadQualificationSessionGetPayload<object>;
type AnalysisRecord = Prisma.LeadAnalysisGetPayload<object>;

@Injectable()
export class QualificationSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly engine: QualificationEngineService,
    private readonly activities: ActivitiesService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async start(leadId: string, dto: StartQualificationSessionDto): Promise<QualificationSessionView> {
    const { tenantId } = this.tenantContext.requireContext();

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true },
    });
    if (!lead) {
      throw new QualificationLeadNotFoundError();
    }

    const active = await this.prisma.leadQualificationSession.findFirst({
      where: {
        tenantId,
        leadId,
        status: { in: [QualificationSessionStatus.PENDING, QualificationSessionStatus.BOT_QUALIFYING] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) {
      return toSessionView(active);
    }

    const profile = await this.resolveProfile(tenantId, dto.profileId);
    const requiredKeys = asItems<AiRequiredInformationItem>(profile.requiredInformation).map(
      (item) => item.key,
    );

    const transcript: AiConversationEntry[] = [];
    if (profile.initialMessage) {
      transcript.push({ role: 'BOT', content: profile.initialMessage, at: new Date().toISOString() });
    }

    const session = await this.prisma.leadQualificationSession.create({
      data: {
        tenantId,
        leadId,
        profileId: profile.id,
        profileVersion: profile.version,
        status: QualificationSessionStatus.BOT_QUALIFYING,
        collectedData: {},
        missingInformation: json(requiredKeys),
        transcript: json(transcript),
      },
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: 'QUALIFYING' },
    });

    await this.activities.record({
      entity: 'qualification_session',
      entityId: session.id,
      action: 'started',
      metadata: { leadId, profileId: profile.id, profileVersion: profile.version },
    });

    return toSessionView(session);
  }

  async findOne(sessionId: string): Promise<QualificationSessionView> {
    const { tenantId } = this.tenantContext.requireContext();
    const session = await this.prisma.leadQualificationSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      throw new QualificationSessionNotFoundError();
    }
    return toSessionView(session);
  }

  async list(
    query: ListQualificationSessionsQueryDto,
  ): Promise<PageResult<QualificationSessionView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.LeadQualificationSessionWhereInput = { tenantId };
    if (query.leadId) where.leadId = query.leadId;
    if (query.status) where.status = query.status;

    const [total, sessions] = await this.prisma.$transaction([
      this.prisma.leadQualificationSession.count({ where }),
      this.prisma.leadQualificationSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(sessions.map(toSessionView), total, query.page, query.perPage);
  }

  async evaluate(
    sessionId: string,
    dto: EvaluateQualificationMessageDto,
  ): Promise<EvaluateSessionResult> {
    const { tenantId } = this.tenantContext.requireContext();
    const session = await this.prisma.leadQualificationSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      throw new QualificationSessionNotFoundError();
    }
    if (
      session.status !== QualificationSessionStatus.BOT_QUALIFYING &&
      session.status !== QualificationSessionStatus.PENDING
    ) {
      throw new QualificationSessionNotActiveError();
    }

    const profile = await this.requireProfile(tenantId, session.profileId);
    const message = dto.message.trim();
    const transcript = readTranscript(session.transcript);
    transcript.push({ role: 'LEAD', content: message, at: new Date().toISOString() });

    const decision = await this.engine.evaluate({
      profile: buildProfileConfig(profile),
      dataSensitivityLevel: profile.dataSensitivityLevel,
      collectedData: asRecord(session.collectedData),
      transcript,
      lastLeadMessage: message,
    });

    if (decision.action === 'ASK') {
      transcript.push({
        role: 'BOT',
        content: decision.question,
        at: new Date().toISOString(),
      });

      const updated = await this.prisma.leadQualificationSession.update({
        where: { id: session.id },
        data: {
          status: QualificationSessionStatus.BOT_QUALIFYING,
          collectedData: json(decision.collectedData),
          missingInformation: json(decision.missingInformation),
          transcript: json(transcript),
          questionCount: { increment: 1 },
          lastInteractionAt: new Date(),
        },
      });

      return { session: toSessionView(updated), analysis: null, decision };
    }

    if (decision.action === 'NEEDS_HUMAN') {
      return this.applyNeedsHuman(session, transcript, decision.reason, decision.collectedData, decision.missingInformation);
    }

    return this.applyCompletion(session, profile, transcript, decision);
  }

  async requestReview(sessionId: string): Promise<QualificationSessionView> {
    const { tenantId } = this.tenantContext.requireContext();
    const session = await this.prisma.leadQualificationSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      throw new QualificationSessionNotFoundError();
    }
    if (
      session.status !== QualificationSessionStatus.QUALIFIED &&
      session.status !== QualificationSessionStatus.DISQUALIFIED
    ) {
      throw new QualificationSessionNotCompletedError();
    }

    const now = new Date();
    const updated = await this.prisma.leadQualificationSession.update({
      where: { id: session.id },
      data: {
        status: QualificationSessionStatus.NEEDS_HUMAN,
        reviewRequested: true,
        reviewRequestedAt: now,
        handoffReason: 'lead_requested_review',
        lastInteractionAt: now,
      },
    });

    await this.prisma.lead.update({
      where: { id: session.leadId },
      data: { status: 'NEEDS_HUMAN' },
    });

    await this.activities.record({
      entity: 'qualification_session',
      entityId: session.id,
      action: 'review_requested',
      metadata: { previousStatus: session.status },
    });

    return toSessionView(updated);
  }

  async reanalyze(sessionId: string): Promise<EvaluateSessionResult> {
    const { tenantId } = this.tenantContext.requireContext();
    const session = await this.prisma.leadQualificationSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      throw new QualificationSessionNotFoundError();
    }
    if (
      session.status !== QualificationSessionStatus.QUALIFIED &&
      session.status !== QualificationSessionStatus.DISQUALIFIED &&
      session.status !== QualificationSessionStatus.NEEDS_HUMAN
    ) {
      throw new QualificationSessionNotCompletedError();
    }

    const profile = await this.requireProfile(tenantId, session.profileId);
    const transcript = readTranscript(session.transcript);

    const decision = await this.engine.evaluate({
      profile: buildProfileConfig(profile),
      dataSensitivityLevel: profile.dataSensitivityLevel,
      collectedData: asRecord(session.collectedData),
      transcript,
    });

    await this.activities.record({
      entity: 'qualification_session',
      entityId: session.id,
      action: 'reanalyzed',
      metadata: { result: decision.action },
    });

    if (decision.action === 'COMPLETE') {
      return this.applyCompletion(session, profile, transcript, decision);
    }

    const reason = decision.action === 'NEEDS_HUMAN' ? decision.reason : 'reanalysis_inconclusive';
    return this.applyNeedsHuman(session, transcript, reason, decision.collectedData, decision.missingInformation);
  }

  async findAnalysis(analysisId: string): Promise<LeadAnalysisView> {
    const { tenantId } = this.tenantContext.requireContext();
    const analysis = await this.prisma.leadAnalysis.findFirst({
      where: { id: analysisId, tenantId },
    });
    if (!analysis) {
      throw new QualificationAnalysisNotFoundError();
    }
    return toAnalysisView(analysis);
  }

  async listAnalyses(query: ListLeadAnalysesQueryDto): Promise<PageResult<LeadAnalysisView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.LeadAnalysisWhereInput = { tenantId };
    if (query.leadId) where.leadId = query.leadId;
    if (query.outcome) where.outcome = query.outcome;

    const [total, analyses] = await this.prisma.$transaction([
      this.prisma.leadAnalysis.count({ where }),
      this.prisma.leadAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(analyses.map(toAnalysisView), total, query.page, query.perPage);
  }

  private async applyNeedsHuman(
    session: SessionRecord,
    transcript: AiConversationEntry[],
    reason: string,
    collectedData: Record<string, unknown>,
    missingInformation: string[],
  ): Promise<EvaluateSessionResult> {
    const now = new Date();
    const updated = await this.prisma.leadQualificationSession.update({
      where: { id: session.id },
      data: {
        status: QualificationSessionStatus.NEEDS_HUMAN,
        collectedData: json(collectedData),
        missingInformation: json(missingInformation),
        transcript: json(transcript),
        handoffReason: reason,
        lastInteractionAt: now,
        completedAt: session.completedAt ?? now,
      },
    });

    await this.prisma.lead.update({
      where: { id: session.leadId },
      data: { status: 'NEEDS_HUMAN' },
    });

    await this.activities.record({
      entity: 'qualification_session',
      entityId: session.id,
      action: 'needs_human',
      metadata: { reason },
    });

    return { session: toSessionView(updated), analysis: null, decision: { action: 'NEEDS_HUMAN', reason, collectedData, missingInformation } };
  }

  private async applyCompletion(
    session: SessionRecord,
    profile: QualificationProfile,
    transcript: AiConversationEntry[],
    decision: Extract<EngineDecision, { action: 'COMPLETE' }>,
  ): Promise<EvaluateSessionResult> {
    const now = new Date();
    const status =
      decision.outcome === 'QUALIFIED'
        ? QualificationSessionStatus.QUALIFIED
        : QualificationSessionStatus.DISQUALIFIED;

    const { updatedSession, analysis } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leadQualificationSession.update({
        where: { id: session.id },
        data: {
          status,
          collectedData: json(decision.collectedData),
          missingInformation: json(decision.missingInformation),
          transcript: json(transcript),
          completedAt: now,
          lastInteractionAt: now,
        },
      });

      const createdAnalysis = await tx.leadAnalysis.create({
        data: {
          tenantId: session.tenantId,
          leadId: session.leadId,
          sessionId: session.id,
          profileId: profile.id,
          profileVersion: profile.version,
          provider: this.ai.info.provider,
          model: this.ai.info.model,
          outcome: decision.outcome,
          score: decision.score,
          qualificationLevel: decision.qualificationLevel,
          summary: decision.summary,
          collectedData: json(decision.collectedData),
          strengths: json(decision.strengths),
          risks: json(decision.risks),
          missingInformation: json(decision.missingInformation),
          recommendedNextStep: decision.recommendedNextStep,
          qualificationReasons: json(decision.qualificationReasons),
          completedAt: now,
        },
      });

      return { updatedSession: updated, analysis: createdAnalysis };
    });

    await this.prisma.lead.update({
      where: { id: session.leadId },
      data: {
        status: decision.outcome === 'QUALIFIED' ? 'QUALIFIED_WAITING_DIGEST' : 'DISQUALIFIED',
      },
    });

    await this.activities.record({
      entity: 'qualification_session',
      entityId: session.id,
      action: 'completed',
      metadata: { outcome: decision.outcome, analysisId: analysis.id },
    });

    return {
      session: toSessionView(updatedSession),
      analysis: toAnalysisView(analysis),
      decision,
    };
  }

  private async resolveProfile(
    tenantId: string,
    profileId?: string,
  ): Promise<QualificationProfile> {
    if (profileId) {
      const profile = await this.prisma.qualificationProfile.findFirst({
        where: { id: profileId, tenantId, active: true },
      });
      if (!profile) {
        throw new QualificationProfileUnavailableError();
      }
      return profile;
    }

    const defaultProfile = await this.prisma.qualificationProfile.findFirst({
      where: { tenantId, active: true, isDefault: true },
    });
    if (defaultProfile) {
      return defaultProfile;
    }

    const fallback = await this.prisma.qualificationProfile.findFirst({
      where: { tenantId, active: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!fallback) {
      throw new QualificationProfileUnavailableError();
    }
    return fallback;
  }

  private async requireProfile(tenantId: string, profileId: string): Promise<QualificationProfile> {
    const profile = await this.prisma.qualificationProfile.findFirst({
      where: { id: profileId, tenantId },
    });
    if (!profile) {
      throw new QualificationProfileUnavailableError();
    }
    return profile;
  }
}

function buildProfileConfig(profile: QualificationProfile): AiProfileConfig {
  return {
    name: profile.name,
    businessContext: profile.businessContext,
    botName: profile.botName,
    tone: profile.tone,
    objective: profile.objective,
    requiredInformation: asItems<AiRequiredInformationItem>(profile.requiredInformation),
    qualificationCriteria: asItems<AiCriterionItem>(profile.qualificationCriteria),
    disqualificationCriteria: asItems<AiCriterionItem>(profile.disqualificationCriteria),
    completionCriteria: asItems<AiListItem>(profile.completionCriteria),
    humanHandoffRules: asItems<AiListItem>(profile.humanHandoffRules),
    qualificationLevels: asItems<AiListItem>(profile.qualificationLevels),
    customInstructions: profile.customInstructions,
    privacyNoticeText: profile.privacyNoticeText,
  };
}

function toSessionView(session: SessionRecord): QualificationSessionView {
  return {
    id: session.id,
    leadId: session.leadId,
    profileId: session.profileId,
    profileVersion: session.profileVersion,
    status: session.status,
    collectedData: session.collectedData,
    missingInformation: session.missingInformation,
    transcript: readTranscript(session.transcript),
    questionCount: session.questionCount,
    reviewRequested: session.reviewRequested,
    reviewRequestedAt: session.reviewRequestedAt,
    handoffReason: session.handoffReason,
    startedAt: session.startedAt,
    lastInteractionAt: session.lastInteractionAt,
    completedAt: session.completedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function toAnalysisView(analysis: AnalysisRecord): LeadAnalysisView {
  return {
    id: analysis.id,
    leadId: analysis.leadId,
    sessionId: analysis.sessionId,
    profileId: analysis.profileId,
    profileVersion: analysis.profileVersion,
    provider: analysis.provider,
    model: analysis.model,
    outcome: analysis.outcome,
    score: analysis.score,
    qualificationLevel: analysis.qualificationLevel,
    summary: analysis.summary,
    collectedData: analysis.collectedData,
    strengths: analysis.strengths,
    risks: analysis.risks,
    missingInformation: analysis.missingInformation,
    recommendedNextStep: analysis.recommendedNextStep,
    qualificationReasons: analysis.qualificationReasons,
    createdAt: analysis.createdAt,
    completedAt: analysis.completedAt,
  };
}

function asItems<T>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as unknown as T[]) : [];
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readTranscript(value: Prisma.JsonValue): AiConversationEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: AiConversationEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    if ((role === 'LEAD' || role === 'BOT') && typeof content === 'string') {
      entries.push({ role, content, at: typeof record.at === 'string' ? record.at : '' });
    }
  }

  return entries;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
