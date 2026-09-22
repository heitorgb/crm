export type QualificationStatus =
  | 'BOT_QUALIFYING'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'NEEDS_HUMAN'
  | 'WAITING_DIGEST'
  | 'HANDED_OFF';

export type QualificationLevel = 'high' | 'medium' | 'low';

export interface QualificationCollectedField {
  label: string;
  value: string;
}

export interface QualificationAnalysis {
  id: string;
  leadName: string;
  status: QualificationStatus;
  score: number;
  level: QualificationLevel;
  summary: string;
  collectedData: QualificationCollectedField[];
  strengths: string[];
  risks: string[];
  missing: string[];
  nextAction: string;
  completedAt: string;
  model: string;
}

export interface QualificationLead {
  id: string;
  name: string;
  company: string;
  phone: string;
  status: QualificationStatus;
  score: number | null;
  level: QualificationLevel | null;
  updatedAt: string;
}

export type DigestChannel = 'whatsapp' | 'email' | 'in_app';

export interface DigestSettings {
  enabled: boolean;
  time: string;
  timezone: string;
  channel: DigestChannel;
}

export type DataSensitivityLevel = 'low' | 'medium' | 'high';

export interface ProfileItem {
  key: string;
  label: string;
  description?: string;
}

export interface RequiredInformationItem extends ProfileItem {
  required?: boolean;
}

export interface CriterionItem extends ProfileItem {
  weight?: number;
}

export interface QualificationProfile {
  id: string;
  name: string;
  description: string | null;
  businessContext: string | null;
  botName: string | null;
  initialMessage: string | null;
  privacyNoticeText: string | null;
  tone: string | null;
  objective: string | null;
  requiredInformation: RequiredInformationItem[];
  qualificationCriteria: CriterionItem[];
  disqualificationCriteria: CriterionItem[];
  completionCriteria: ProfileItem[];
  customInstructions: string | null;
  qualifiedMessage: string | null;
  disqualifiedMessage: string | null;
  needsHumanMessage: string | null;
  humanHandoffRules: ProfileItem[];
  qualificationLevels: ProfileItem[];
  dataSensitivityLevel: DataSensitivityLevel;
  isDefault: boolean;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type QualificationProfileDraft = Omit<
  QualificationProfile,
  'id' | 'version' | 'createdAt' | 'updatedAt'
>;

export type QualificationProfileInput = Partial<QualificationProfileDraft> & { name: string };


