export type AiProvider = 'OPENAI' | 'DEEPSEEK' | 'ANTHROPIC' | 'OPENROUTER';

export type AiFormality = 'PROFESSIONAL' | 'FORMAL' | 'VERY_FORMAL';

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
}

export interface AiProviderOption {
  id: AiProvider;
  label: string;
  description: string;
  credentialLabel: string;
  models: AiModelOption[];
}

export interface AiFormalityOption {
  id: AiFormality;
  label: string;
  description: string;
}

export interface AiCatalog {
  providers: AiProviderOption[];
  formalities: AiFormalityOption[];
}

export interface AiSettings {
  provider: AiProvider;
  model: string;
  formality: AiFormality;
  enabled: boolean;
  hasCredentials: boolean;
  configuredProviders: AiProvider[];
  available: boolean;
  updatedAt: string | null;
}

export interface UpdateAiSettingsInput {
  provider: AiProvider;
  model: string;
  formality: AiFormality;
  enabled?: boolean;
  apiKey?: string;
  clearCredentials?: boolean;
}

export interface TestAiConnectionInput {
  provider: AiProvider;
  model: string;
  apiKey?: string;
}

export interface AiConnectionTestResult {
  ok: true;
  provider: AiProvider;
  model: string;
  message: string;
}

export interface AiFormalizationResult {
  text: string;
}

export interface SalesCopilotContextSummary {
  leadId: string;
  conversationId: string | null;
  messageCount: number;
  latestMessageId: string | null;
  latestMessageAt: string | null;
  leadUpdatedAt: string;
  historyTruncated: boolean;
  mediaWithoutText: number;
}

export type SalesUpdateField =
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

export type SalesRecommendationPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type SalesRecommendationStatus =
  | 'RECOMMENDED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'CANCELED';
export type SalesFollowUpStatus = 'PENDING' | 'COMPLETED' | 'CANCELED';

export interface SalesNextAction {
  action: string;
  reason: string;
  priority: SalesRecommendationPriority;
  expectedOutcome: string;
  missingInformation: string[];
  suggestedDueAt: string | null;
  suggestedMessage: string | null;
}

export interface SalesLeadUpdateSuggestion {
  field: SalesUpdateField;
  proposedValue: string;
  evidence: string;
}

export interface SalesPersistedContext {
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
  provider: AiProvider;
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

export interface SalesRecommendation {
  id: string;
  leadId: string;
  conversationId: string | null;
  kind: 'NEXT_ACTION' | 'LEAD_UPDATE';
  status: SalesRecommendationStatus;
  priority: SalesRecommendationPriority;
  action: string;
  reason: string;
  expectedOutcome: string | null;
  missingInformation: string[];
  suggestedDueAt: string | null;
  suggestedMessage: string | null;
  updateField: SalesUpdateField | null;
  proposedValue: string | null;
  evidence: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  result: Record<string, unknown>;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  createdAt: string;
}

export interface SalesFollowUp {
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
  status: SalesFollowUpStatus;
  completedAt: string | null;
  canceledAt: string | null;
  rescheduleCount: number;
  lastRescheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesCopilotState {
  context: SalesPersistedContext | null;
  stale: boolean;
  staleReasons: string[];
  nextAction: SalesRecommendation | null;
  leadUpdateSuggestions: SalesRecommendation[];
  recommendations: SalesRecommendation[];
  followUps: SalesFollowUp[];
}

export interface SalesAnalysis {
  summary: string;
  objective: string;
  need: string;
  knownInformation: string[];
  hypotheses: string[];
  pendingInformation: string[];
  nextQuestion: string;
  suggestedReply: string;
  rationale: string;
  nextAction: SalesNextAction;
  leadUpdateSuggestions: SalesLeadUpdateSuggestion[];
  provider: AiProvider;
  model: string;
  generatedAt: string;
  promptVersion: string;
  context: SalesCopilotContextSummary;
  state: SalesCopilotState;
}

export interface SalesReplySuggestion {
  reply: string;
  provider: AiProvider;
  model: string;
  generatedAt: string;
  promptVersion: string;
  context: SalesCopilotContextSummary;
}

export interface AnalyzeSalesOpportunityInput {
  leadId: string;
  conversationId?: string;
}

export interface SuggestSalesReplyInput {
  leadId: string;
  conversationId?: string;
  previousAnalysis?: string;
}

export interface UpdateSalesRecommendationInput {
  action: 'ACCEPT' | 'REJECT' | 'CANCEL';
  value?: string;
}

export interface CreateSalesFollowUpInput {
  leadId: string;
  conversationId?: string;
  recommendationId?: string;
  action: string;
  reason?: string;
  dueAt?: string;
  ownerId?: string | null;
  suggestedMessage?: string;
  idempotencyKey: string;
}

export interface UpdateSalesFollowUpInput {
  status?: 'COMPLETED' | 'CANCELED';
  dueAt?: string;
  ownerId?: string;
  reason?: string;
  suggestedMessage?: string;
  result?: string;
}
