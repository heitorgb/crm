import { apiRequest } from '@/lib/api-client';
import type {
  AiCatalog,
  AiConnectionTestResult,
  AiFormalizationResult,
  AiProvider,
  AiSettings,
  AnalyzeSalesOpportunityInput,
  CreateSalesFollowUpInput,
  SalesAnalysis,
  SalesCopilotState,
  SalesFollowUp,
  SalesRecommendation,
  SalesReplySuggestion,
  SuggestSalesReplyInput,
  TestAiConnectionInput,
  TranscriptionCatalog,
  TranscriptionConnectionTestResult,
  TranscriptionSettings,
  UpdateAiCredentialInput,
  UpdateAiSettingsInput,
  UpdateSalesFollowUpInput,
  UpdateSalesRecommendationInput,
  UpdateTranscriptionSettingsInput,
} from '@/types/ai';

export const aiService = {
  getCatalog: () => apiRequest<AiCatalog>('/ai/catalog'),

  getSettings: () => apiRequest<AiSettings>('/ai/settings'),

  saveSettings: (input: UpdateAiSettingsInput) =>
    apiRequest<AiSettings>('/ai/settings', { method: 'PUT', body: input }),

  saveCredential: (provider: AiProvider, input: UpdateAiCredentialInput) =>
    apiRequest<AiSettings>(`/ai/credentials/${provider}`, {
      method: 'PUT',
      body: input,
    }),

  testConnection: (input: TestAiConnectionInput) =>
    apiRequest<AiConnectionTestResult>('/ai/test', {
      method: 'POST',
      body: input,
    }),

  getTranscriptionCatalog: () =>
    apiRequest<TranscriptionCatalog>('/ai/transcription/catalog'),

  getTranscriptionSettings: () =>
    apiRequest<TranscriptionSettings>('/ai/transcription/settings'),

  saveTranscriptionSettings: (input: UpdateTranscriptionSettingsInput) =>
    apiRequest<TranscriptionSettings>('/ai/transcription/settings', {
      method: 'PUT',
      body: input,
    }),

  testTranscription: () =>
    apiRequest<TranscriptionConnectionTestResult>('/ai/transcription/test', {
      method: 'POST',
      body: {},
    }),

  formalize: (text: string) =>
    apiRequest<AiFormalizationResult>('/ai/formalize', {
      method: 'POST',
      body: { text },
    }),

  analyzeSalesOpportunity: (input: AnalyzeSalesOpportunityInput) =>
    apiRequest<SalesAnalysis>('/ai/sales/analyze', {
      method: 'POST',
      body: input,
    }),

  suggestSalesReply: (input: SuggestSalesReplyInput) =>
    apiRequest<SalesReplySuggestion>('/ai/sales/suggest-reply', {
      method: 'POST',
      body: input,
    }),

  getSalesContext: (params: AnalyzeSalesOpportunityInput) => {
    const query = new URLSearchParams({ leadId: params.leadId });
    if (params.conversationId) query.set('conversationId', params.conversationId);
    return apiRequest<SalesCopilotState>(`/ai/sales/context?${query.toString()}`);
  },

  decideSalesRecommendation: (id: string, input: UpdateSalesRecommendationInput) =>
    apiRequest<SalesRecommendation>(`/ai/sales/recommendations/${id}`, {
      method: 'PATCH',
      body: input,
    }),

  createSalesFollowUp: (input: CreateSalesFollowUpInput) =>
    apiRequest<SalesFollowUp>('/ai/sales/follow-ups', {
      method: 'POST',
      body: input,
    }),

  updateSalesFollowUp: (id: string, input: UpdateSalesFollowUpInput) =>
    apiRequest<SalesFollowUp>(`/ai/sales/follow-ups/${id}`, {
      method: 'PATCH',
      body: input,
    }),
};
