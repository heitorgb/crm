export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface TagSummary {
  id: string;
  name: string;
  color: string | null;
}

export interface Tag extends TagSummary {
  customerCount: number;
  conversationCount: number;
  leadCount: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  address: string | null;
  position: string | null;
  isPrimary: boolean;
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  document: string | null;
  status: CustomerStatus;
  tags: TagSummary[];
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetail extends Omit<Customer, 'contactCount'> {
  contacts: CustomerContact[];
}

export interface Contact {
  id: string;
  customerId: string | null;
  customerName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  address: string | null;
  position: string | null;
  avatarUrl: string | null;
  isPrimary: boolean;
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface PageResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface CustomerInput {
  name: string;
  document?: string | null;
  status?: CustomerStatus;
  tagIds?: string[];
}

export interface ContactInput {
  customerId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  address?: string | null;
  position?: string | null;
  isPrimary?: boolean;
  isBlocked?: boolean;
}

export interface TagInput {
  name: string;
  color?: string | null;
}

export type LeadStatus = 'OPEN' | 'WON' | 'LOST';
export type LeadStageKind = LeadStatus;

export interface LeadPipeline {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  stages: LeadStage[];
}

export interface LeadStage {
  id: string;
  pipelineId: string;
  name: string;
  color: string | null;
  position: number;
  kind: LeadStageKind;
}

export interface LeadCard {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  ownerId: string | null;
  ownerName: string | null;
  title: string;
  source: string | null;
  valueCents: number;
  status: LeadStatus;
  notes: string | null;
  nextFollowUpAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: Pick<Contact, 'id' | 'name' | 'phone' | 'email' | 'avatarUrl'>;
  tags: TagSummary[];
}

export interface LeadBoardStage extends LeadStage {
  leadCount: number;
  valueCents: number;
  leads: LeadCard[];
}

export interface LeadBoard {
  pipeline: Omit<LeadPipeline, 'stages'>;
  stages: LeadBoardStage[];
}

export interface LeadInput {
  pipelineId: string;
  stageId: string;
  contactId: string;
  ownerId?: string | null;
  title: string;
  source?: string | null;
  valueCents?: number;
  notes?: string | null;
  nextFollowUpAt?: string | null;
  tagIds?: string[];
}
