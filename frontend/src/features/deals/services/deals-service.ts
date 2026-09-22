import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type { Deal, DealBoard, DealInput, DealStatus } from '@/types/sales';

export interface ListDealsParams {
  page?: number;
  perPage?: number;
  search?: string;
  pipelineId?: string;
  stageId?: string;
  status?: DealStatus;
  ownerId?: string;
  customerId?: string;
  leadId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const dealsService = {
  list: (params: ListDealsParams = {}) =>
    apiRequest<PageResult<Deal>>(
      `/deals${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        pipelineId: params.pipelineId,
        stageId: params.stageId,
        status: params.status,
        ownerId: params.ownerId,
        customerId: params.customerId,
        leadId: params.leadId,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  board: (pipelineId: string, limitPerStage?: number) =>
    apiRequest<DealBoard>(
      `/deals/board${toQueryString({ pipelineId, limitPerStage })}`,
    ),

  get: (id: string) => apiRequest<Deal>(`/deals/${id}`),

  create: (input: DealInput) => apiRequest<Deal>('/deals', { method: 'POST', body: input }),

  update: (id: string, input: Partial<DealInput>) =>
    apiRequest<Deal>(`/deals/${id}`, { method: 'PATCH', body: input }),

  move: (id: string, stageId: string) =>
    apiRequest<Deal>(`/deals/${id}/stage`, { method: 'PATCH', body: { stageId } }),

  remove: (id: string) => apiRequest<void>(`/deals/${id}`, { method: 'DELETE' }),
};
