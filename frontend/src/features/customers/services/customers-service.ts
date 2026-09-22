import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type {
  Customer,
  CustomerDetail,
  CustomerInput,
  CustomerStatus,
  PageResult,
} from '@/types/crm';

export interface ListCustomersParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: CustomerStatus;
  tagId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const customersService = {
  list: (params: ListCustomersParams) =>
    apiRequest<PageResult<Customer>>(
      `/customers${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status,
        tagId: params.tagId,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<CustomerDetail>(`/customers/${id}`),

  create: (input: CustomerInput) =>
    apiRequest<CustomerDetail>('/customers', { method: 'POST', body: input }),

  update: (id: string, input: Partial<CustomerInput>) =>
    apiRequest<CustomerDetail>(`/customers/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/customers/${id}`, { method: 'DELETE' }),
};
