export interface AiRequiredInformationItem {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface AiCriterionItem {
  key: string;
  label: string;
  description?: string;
  weight?: number;
}

export interface AiListItem {
  key: string;
  label: string;
  description?: string;
}

export interface AiProfileConfig {
  name: string;
  businessContext: string | null;
  botName: string | null;
  tone: string | null;
  objective: string | null;
  requiredInformation: AiRequiredInformationItem[];
  qualificationCriteria: AiCriterionItem[];
  disqualificationCriteria: AiCriterionItem[];
  completionCriteria: AiListItem[];
  humanHandoffRules: AiListItem[];
  qualificationLevels: AiListItem[];
  customInstructions: string | null;
  privacyNoticeText: string | null;
}

export interface AiConversationEntry {
  role: 'LEAD' | 'BOT';
  content: string;
  at: string;
}

export interface AiEvaluationInput {
  profile: AiProfileConfig;
  collectedData: Record<string, unknown>;
  missingInformation: string[];
  transcript: AiConversationEntry[];
  lastLeadMessage?: string;
}

export interface AiProviderInfo {
  provider: string;
  model: string;
}

export interface AiProvider {
  readonly info: AiProviderInfo;
  /** Returns the raw structured decision from the model. Validation is the engine's job. */
  evaluate(input: AiEvaluationInput): Promise<unknown>;
}

export const AI_PROVIDER = 'AI_PROVIDER';
