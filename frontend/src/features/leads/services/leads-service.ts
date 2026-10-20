import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { LeadBoard, LeadCard, LeadInput, LeadPipeline } from '@/types/crm';

export interface LeadBoardParams {
  pipelineId?: string;
  search?: string;
  ownerId?: string;
  limitPerStage?: number;
}

export const leadsService = {
  pipelines: () => apiRequest<LeadPipeline[]>('/leads/pipelines'),

  createPipeline: (input: { name: string; description?: string }) =>
    apiRequest<LeadPipeline>('/leads/pipelines', { method: 'POST', body: input }),

  updatePipeline: (id: string, input: { name?: string; description?: string | null; active?: boolean }) =>
    apiRequest<LeadPipeline>(`/leads/pipelines/${id}`, { method: 'PATCH', body: input }),

  createStage: (pipelineId: string, input: { name: string; color?: string; kind?: string }) =>
    apiRequest(`/leads/pipelines/${pipelineId}/stages`, { method: 'POST', body: input }),

  updateStage: (pipelineId: string, stageId: string, input: { name?: string; color?: string; kind?: string }) =>
    apiRequest(`/leads/pipelines/${pipelineId}/stages/${stageId}`, { method: 'PATCH', body: input }),

  removeStage: (pipelineId: string, stageId: string) =>
    apiRequest<void>(`/leads/pipelines/${pipelineId}/stages/${stageId}`, { method: 'DELETE' }),

  board: (params: LeadBoardParams) =>
    apiRequest<LeadBoard>(
      `/leads/board${toQueryString({
        pipelineId: params.pipelineId,
        search: params.search,
        ownerId: params.ownerId,
        limitPerStage: params.limitPerStage,
      })}`,
    ),

  create: (input: LeadInput) =>
    apiRequest<LeadCard>('/leads', { method: 'POST', body: input }),

  update: (id: string, input: Partial<Omit<LeadInput, 'pipelineId'>>) =>
    apiRequest<LeadCard>(`/leads/${id}`, { method: 'PATCH', body: input }),

  move: (id: string, stageId: string) =>
    apiRequest<LeadCard>(`/leads/${id}/stage`, { method: 'PATCH', body: { stageId } }),

  remove: (id: string) => apiRequest<void>(`/leads/${id}`, { method: 'DELETE' }),
};
