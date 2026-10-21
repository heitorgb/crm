import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type { QuickReply, QuickReplyInput } from '@/types/quick-replies';

export interface ListQuickRepliesParams {
  page?: number;
  perPage?: number;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const quickRepliesService = {
  list: (params: ListQuickRepliesParams = {}) =>
    apiRequest<PageResult<QuickReply>>(
      `/quick-replies${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<QuickReply>(`/quick-replies/${id}`),

  create: (input: QuickReplyInput) =>
    apiRequest<QuickReply>('/quick-replies', { method: 'POST', body: input }),

  update: (id: string, input: Partial<QuickReplyInput>) =>
    apiRequest<QuickReply>(`/quick-replies/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/quick-replies/${id}`, { method: 'DELETE' }),
};
