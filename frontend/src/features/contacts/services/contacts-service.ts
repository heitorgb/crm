import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { Contact, ContactInput, PageResult } from '@/types/crm';

export interface ListContactsParams {
  page?: number;
  perPage?: number;
  search?: string;
  customerId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const contactsService = {
  list: (params: ListContactsParams) =>
    apiRequest<PageResult<Contact>>(
      `/contacts${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        customerId: params.customerId,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<Contact>(`/contacts/${id}`),

  create: (input: ContactInput) => apiRequest<Contact>('/contacts', { method: 'POST', body: input }),

  update: (id: string, input: Partial<ContactInput>) =>
    apiRequest<Contact>(`/contacts/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/contacts/${id}`, { method: 'DELETE' }),
};
