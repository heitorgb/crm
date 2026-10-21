export const SALES_COPILOT_PROMPT_VERSION = 'sales-copilot-v1';
export const SALES_MAX_HISTORY_MESSAGES = 80;
export const SALES_MAX_HISTORY_CHARS = 24_000;
export const SALES_MAX_PREVIOUS_ANALYSIS_CHARS = 4_000;
export const SALES_MAX_OUTPUT_TOKENS = 4096;

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
  leadUpdatedAt: string;
  historyTruncated: boolean;
  mediaWithoutText: number;
}

export interface SalesCopilotContext {
  opportunity: SalesOpportunityContext;
  conversation: SalesConversationContext | null;
  transcript: string;
  summary: SalesContextSummary;
}

export interface SalesAnalysisPayload {
  summary: string;
  need: string;
  knownInformation: string[];
  pendingInformation: string[];
  nextQuestion: string;
  suggestedReply: string;
  rationale: string;
}

export interface SalesAnalysisView extends SalesAnalysisPayload {
  provider: string;
  model: string;
  generatedAt: string;
  promptVersion: string;
  context: SalesContextSummary;
}

export interface SalesReplyView {
  reply: string;
  provider: string;
  model: string;
  generatedAt: string;
  promptVersion: string;
  context: SalesContextSummary;
}
