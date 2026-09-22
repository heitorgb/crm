import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type { Lead, LeadInput, LeadStatus } from '@/types/sales';

export interface ListLeadsParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: LeadStatus;
  customerId?: string;
  tagId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const leadsService = {
  list: (params: ListLeadsParams = {}) =>
    apiRequest<PageResult<Lead>>(
      `/leads${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status,
        customerId: params.customerId,
        tagId: params.tagId,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<Lead>(`/leads/${id}`),

  create: (input: LeadInput) => apiRequest<Lead>('/leads', { method: 'POST', body: input }),

  update: (id: string, input: Partial<LeadInput>) =>
    apiRequest<Lead>(`/leads/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/leads/${id}`, { method: 'DELETE' }),
};
