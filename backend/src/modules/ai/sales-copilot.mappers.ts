import { Prisma } from '@prisma/client';
import type {
  SalesFollowUpView,
  SalesPersistedContextView,
  SalesRecommendationView,
} from './sales-copilot.models.js';

export const RECOMMENDATION_INCLUDE = {
  decidedBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.LeadRecommendationInclude;

export type RecommendationRow = Prisma.LeadRecommendationGetPayload<{
  include: typeof RECOMMENDATION_INCLUDE;
}>;

export const FOLLOW_UP_INCLUDE = {
  owner: { select: { user: { select: { name: true } } } },
  createdBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.LeadFollowUpInclude;

export type FollowUpRow = Prisma.LeadFollowUpGetPayload<{
  include: typeof FOLLOW_UP_INCLUDE;
}>;

export function toContextView(
  row: Prisma.LeadCommercialContextGetPayload<object>,
): SalesPersistedContextView {
  return {
    id: row.id,
    leadId: row.leadId,
    conversationId: row.conversationId,
    summary: row.summary,
    objective: row.objective,
    need: row.need,
    knownInformation: stringArray(row.confirmedFacts),
    hypotheses: stringArray(row.hypotheses),
    pendingInformation: stringArray(row.pendingInformation),
    nextQuestion: row.nextQuestion,
    suggestedReply: row.suggestedReply,
    rationale: row.rationale,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    analysisVersion: row.analysisVersion,
    latestMessageId: row.latestMessageId,
    latestMessageAt: row.latestMessageAt?.toISOString() ?? null,
    leadUpdatedAt: row.leadUpdatedAt.toISOString(),
    lastAnalyzedAt: row.lastAnalyzedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toRecommendationView(row: RecommendationRow): SalesRecommendationView {
  return {
    id: row.id,
    leadId: row.leadId,
    conversationId: row.conversationId,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    action: row.action,
    reason: row.reason,
    expectedOutcome: row.expectedOutcome,
    missingInformation: stringArray(row.missingInformation),
    suggestedDueAt: row.suggestedDueAt?.toISOString() ?? null,
    suggestedMessage: row.suggestedMessage,
    updateField: row.updateField,
    proposedValue: row.proposedValue,
    evidence: row.evidence,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedByName: row.decidedBy?.user.name ?? null,
    result: record(row.result),
    beforeData: record(row.beforeData),
    afterData: record(row.afterData),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toFollowUpView(row: FollowUpRow): SalesFollowUpView {
  return {
    id: row.id,
    leadId: row.leadId,
    conversationId: row.conversationId,
    recommendationId: row.recommendationId,
    action: row.action,
    reason: row.reason,
    dueAt: row.dueAt?.toISOString() ?? null,
    ownerId: row.ownerId,
    ownerName: row.owner?.user.name ?? null,
    createdByMembershipId: row.createdByMembershipId,
    createdByName: row.createdBy?.user.name ?? null,
    suggestedMessage: row.suggestedMessage,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    rescheduleCount: row.rescheduleCount,
    lastRescheduledAt: row.lastRescheduledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function record(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
