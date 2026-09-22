import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type { QualificationProfile, QualificationProfileInput } from '@/types/qualification';

export interface ListQualificationProfilesParams {
  page?: number;
  perPage?: number;
  search?: string;
  active?: boolean;
  isDefault?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const qualificationProfilesService = {
  list: (params: ListQualificationProfilesParams = {}) =>
    apiRequest<PageResult<QualificationProfile>>(
      `/qualification-profiles${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        active: params.active,
        isDefault: params.isDefault,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<QualificationProfile>(`/qualification-profiles/${id}`),

  create: (input: QualificationProfileInput) =>
    apiRequest<QualificationProfile>('/qualification-profiles', { method: 'POST', body: input }),

  update: (id: string, input: Partial<QualificationProfileInput>) =>
    apiRequest<QualificationProfile>(`/qualification-profiles/${id}`, {
      method: 'PATCH',
      body: input,
    }),

  remove: (id: string) =>
    apiRequest<void>(`/qualification-profiles/${id}`, { method: 'DELETE' }),
};
