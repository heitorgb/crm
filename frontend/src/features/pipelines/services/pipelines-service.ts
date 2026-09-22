import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type {
  Pipeline,
  PipelineDetail,
  PipelineInput,
  PipelineStage,
  PipelineStageInput,
} from '@/types/sales';

export interface ListPipelinesParams {
  page?: number;
  perPage?: number;
  search?: string;
  active?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const pipelinesService = {
  list: (params: ListPipelinesParams = {}) =>
    apiRequest<PageResult<Pipeline>>(
      `/pipelines${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        active: params.active,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<PipelineDetail>(`/pipelines/${id}`),

  create: (input: PipelineInput) => apiRequest<PipelineDetail>('/pipelines', { method: 'POST', body: input }),

  update: (id: string, input: Partial<PipelineInput>) =>
    apiRequest<PipelineDetail>(`/pipelines/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/pipelines/${id}`, { method: 'DELETE' }),

  listStages: (pipelineId: string) =>
    apiRequest<PipelineStage[]>(`/pipelines/${pipelineId}/stages`),

  createStage: (pipelineId: string, input: PipelineStageInput) =>
    apiRequest<PipelineStage>(`/pipelines/${pipelineId}/stages`, { method: 'POST', body: input }),

  updateStage: (pipelineId: string, stageId: string, input: Partial<PipelineStageInput>) =>
    apiRequest<PipelineStage>(`/pipelines/${pipelineId}/stages/${stageId}`, {
      method: 'PATCH',
      body: input,
    }),

  removeStage: (pipelineId: string, stageId: string) =>
    apiRequest<void>(`/pipelines/${pipelineId}/stages/${stageId}`, { method: 'DELETE' }),
};
