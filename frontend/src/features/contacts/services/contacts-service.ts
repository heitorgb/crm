import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type {
  Contact,
  ContactExtraFilter,
  ContactFilter,
  ContactInput,
  ContactListResult,
} from '@/types/crm';

export interface ListContactsParams {
  page?: number;
  perPage?: number;
  search?: string;
  customerId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  filter?: ContactFilter;
  extraFilter?: ContactExtraFilter;
  includeSummary?: boolean;
}

export const contactsService = {
  list: (params: ListContactsParams) =>
    apiRequest<ContactListResult>(
      `/contacts${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        customerId: params.customerId,
        sort: params.sort,
        order: params.order,
        filter: params.filter,
        extraFilter: params.extraFilter,
        includeSummary: params.includeSummary,
      })}`,
    ),

  get: (id: string) => apiRequest<Contact>(`/contacts/${id}`),

  create: (input: ContactInput) => apiRequest<Contact>('/contacts', { method: 'POST', body: input }),

  resolve: (input: { phone: string; name?: string }) =>
    apiRequest<Contact>('/contacts/resolve', { method: 'POST', body: input }),

  update: (id: string, input: Partial<ContactInput>) =>
    apiRequest<Contact>(`/contacts/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/contacts/${id}`, { method: 'DELETE' }),
};
