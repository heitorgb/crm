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

