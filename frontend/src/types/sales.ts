export type LeadStatus =
  | 'NEW'
  | 'QUALIFYING'
  | 'QUALIFIED_WAITING_DIGEST'
  | 'DISQUALIFIED'
  | 'NEEDS_HUMAN'
  | 'ASSIGNED';

export type DealStatus = 'OPEN' | 'WON' | 'LOST';

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface LeadTagSummary {
  id: string;
  name: string;
  color: string | null;
}

export interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: LeadStatus;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
  contactName: string | null;
  tags: LeadTagSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  status?: LeadStatus;
  customerId?: string | null;
  contactId?: string | null;
  tagIds?: string[];
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  dealCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  stageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineDetail extends Omit<Pipeline, 'stageCount'> {
  stages: PipelineStage[];
}

export interface PipelineInput {
  name: string;
  description?: string | null;
  active?: boolean;
}

export interface PipelineStageInput {
  name: string;
  position?: number;
}

export interface Deal {
  id: string;
  title: string;
  description: string | null;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  value: string;
  currency: string;
  status: DealStatus;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  leadName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  expectedCloseAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealBoardStage {
  id: string;
  name: string;
  position: number;
  dealCount: number;
  deals: Deal[];
}

export interface DealBoard {
  pipeline: { id: string; name: string };
  limitPerStage: number;
  stages: DealBoardStage[];
}

export interface DealInput {
  title: string;
  pipelineId: string;
  stageId?: string;
  description?: string | null;
  value?: number;
  currency?: string;
  status?: DealStatus;
  customerId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  ownerId?: string | null;
  expectedCloseAt?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  leadId: string | null;
  leadName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: string | null;
  ownerId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  customerId?: string | null;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'USER';
  active: boolean;
}
