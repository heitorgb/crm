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
