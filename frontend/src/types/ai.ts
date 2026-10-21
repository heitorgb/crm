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

export interface SalesAnalysis {
  summary: string;
  need: string;
  knownInformation: string[];
  pendingInformation: string[];
  nextQuestion: string;
  suggestedReply: string;
  rationale: string;
  provider: AiProvider;
  model: string;
  generatedAt: string;
  promptVersion: string;
  context: SalesCopilotContextSummary;
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
