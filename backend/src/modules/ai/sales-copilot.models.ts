export const SALES_COPILOT_PROMPT_VERSION = 'sales-copilot-v2';
export const SALES_MAX_HISTORY_MESSAGES = 80;
export const SALES_MAX_HISTORY_CHARS = 24_000;
export const SALES_MAX_PREVIOUS_ANALYSIS_CHARS = 4_000;
export const SALES_MAX_OUTPUT_TOKENS = 4096;
export const SALES_MAX_CONTEXT_ITEM_CHARS = 2_000;
export const SALES_MAX_CONTEXT_ITEMS = 20;
export const SALES_MAX_RECOMMENDATION_ACTION_CHARS = 500;
export const SALES_MAX_RECOMMENDATION_REASON_CHARS = 2_000;
export const SALES_MAX_RECOMMENDATION_OUTCOME_CHARS = 1_000;
export const SALES_MAX_RECOMMENDATION_MESSAGE_CHARS = 4_000;
export const SALES_MAX_LEAD_UPDATE_VALUE_CHARS = 2_000;
export const SALES_MAX_LEAD_UPDATE_EVIDENCE_CHARS = 2_000;
export const SALES_MAX_FOLLOW_UP_ACTION_CHARS = 500;
export const SALES_MAX_FOLLOW_UP_REASON_CHARS = 2_000;
export const SALES_MAX_FOLLOW_UP_MESSAGE_CHARS = 4_000;
export const SALES_MAX_LEAD_NOTES_CHARS = 5_000;

export interface SalesOpportunityContext {
  id: string;
  title: string;
  status: string;
  pipeline: string;
  stage: string;
  valueCents: number;
  ownerName: string | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  contactName: string;
  contactPhone: string | null;
}

export interface SalesConversationContext {
  id: string;
  status: string;
  instanceName: string;
  isGroup: boolean;
  groupName: string | null;
  lastMessageAt: string | null;
}

export interface SalesContextSummary {
  leadId: string;
  conversationId: string | null;
  messageCount: number;
  latestMessageId: string | null;
  latestMessageAt: string | null;
  latestTranscriptionAt: string | null;
  leadUpdatedAt: string;
  historyTruncated: boolean;
  mediaWithoutText: number;
  transcriptionsPending: number;
}

export interface SalesPriorActionContext {
  previousContext: {
    objective: string;
    knownInformation: string[];
    hypotheses: string[];
    pendingInformation: string[];
    nextQuestion: string;
  } | null;
  recommendations: Array<{
    kind: string;
    status: string;
    action: string;
    proposedValue: string | null;
    decidedAt: string | null;
  }>;
  followUps: Array<{
    action: string;
    status: string;
    dueAt: string | null;
  }>;
}

export interface SalesCopilotContext {
  opportunity: SalesOpportunityContext;
  conversation: SalesConversationContext | null;
  transcript: string;
  summary: SalesContextSummary;
  priorActions: SalesPriorActionContext;
}

export interface SalesNextActionPayload {
  action: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedOutcome: string;
  missingInformation: string[];
  suggestedDueAt: string | null;
  suggestedMessage: string | null;
}

export interface SalesLeadUpdateSuggestionPayload {
  field:
    | 'NEED'
    | 'PRODUCT'
    | 'BUDGET'
    | 'DEADLINE'
    | 'USERS'
    | 'REQUIREMENTS'
    | 'OBJECTION'
    | 'STAGE'
    | 'LOSS_REASON'
    | 'NOTES';
  proposedValue: string;
  evidence: string;
}

export interface SalesAnalysisPayload {
  summary: string;
  objective: string;
  need: string;
  knownInformation: string[];
  hypotheses: string[];
  pendingInformation: string[];
  nextQuestion: string;
  suggestedReply: string;
  rationale: string;
  nextAction: SalesNextActionPayload;
  leadUpdateSuggestions: SalesLeadUpdateSuggestionPayload[];
}

export interface SalesPersistedContextView {
  id: string;
  leadId: string;
  conversationId: string | null;
  summary: string;
  objective: string;
  need: string;
  knownInformation: string[];
  hypotheses: string[];
  pendingInformation: string[];
  nextQuestion: string;
  suggestedReply: string;
  rationale: string;
  provider: string;
  model: string;
  promptVersion: string;
  analysisVersion: number;
  latestMessageId: string | null;
  latestMessageAt: string | null;
  leadUpdatedAt: string;
  lastAnalyzedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalesRecommendationView {
  id: string;
  leadId: string;
  conversationId: string | null;
  kind: 'NEXT_ACTION' | 'LEAD_UPDATE';
  status: 'RECOMMENDED' | 'ACCEPTED' | 'REJECTED' | 'EXECUTED' | 'CANCELED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  action: string;
  reason: string;
  expectedOutcome: string | null;
  missingInformation: string[];
  suggestedDueAt: string | null;
  suggestedMessage: string | null;
  updateField: SalesLeadUpdateSuggestionPayload['field'] | null;
  proposedValue: string | null;
  evidence: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  result: Record<string, unknown>;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  createdAt: string;
}

export interface SalesFollowUpView {
  id: string;
  leadId: string;
  conversationId: string | null;
  recommendationId: string | null;
  action: string;
  reason: string | null;
  dueAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdByMembershipId: string | null;
  createdByName: string | null;
  suggestedMessage: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELED';
  completedAt: string | null;
  canceledAt: string | null;
  rescheduleCount: number;
  lastRescheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesCopilotStateView {
  context: SalesPersistedContextView | null;
  stale: boolean;
  staleReasons: string[];
  nextAction: SalesRecommendationView | null;
  leadUpdateSuggestions: SalesRecommendationView[];
  recommendations: SalesRecommendationView[];
  followUps: SalesFollowUpView[];
}

export interface SalesAnalysisView extends SalesAnalysisPayload {
  provider: string;
  model: string;
  generatedAt: string;
  promptVersion: string;
  context: SalesContextSummary;
  state: SalesCopilotStateView;
}

export interface SalesReplyView {
  reply: string;
  provider: string;
  model: string;
  generatedAt: string;
  promptVersion: string;
  context: SalesContextSummary;
}
