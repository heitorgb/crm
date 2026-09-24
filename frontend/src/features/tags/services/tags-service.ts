import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult, Tag, TagInput } from '@/types/crm';

export interface ListTagsParams {
  page?: number;
  perPage?: number;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const tagsService = {
  list: (params: ListTagsParams = {}) =>
    apiRequest<PageResult<Tag>>(
      `/tags${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<Tag>(`/tags/${id}`),

  create: (input: TagInput) => apiRequest<Tag>('/tags', { method: 'POST', body: input }),

  update: (id: string, input: Partial<TagInput>) =>
    apiRequest<Tag>(`/tags/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/tags/${id}`, { method: 'DELETE' }),
};
