import { apiRequest } from '@/lib/api-client';
import type {
  AiCatalog,
  AiConnectionTestResult,
  AiFormalizationResult,
  AiSettings,
  TestAiConnectionInput,
  UpdateAiSettingsInput,
} from '@/types/ai';

export const aiService = {
  getCatalog: () => apiRequest<AiCatalog>('/ai/catalog'),

  getSettings: () => apiRequest<AiSettings>('/ai/settings'),

  saveSettings: (input: UpdateAiSettingsInput) =>
    apiRequest<AiSettings>('/ai/settings', { method: 'PUT', body: input }),

  testConnection: (input: TestAiConnectionInput) =>
    apiRequest<AiConnectionTestResult>('/ai/test', {
      method: 'POST',
      body: input,
    }),

  formalize: (text: string) =>
    apiRequest<AiFormalizationResult>('/ai/formalize', {
      method: 'POST',
      body: { text },
    }),
};
