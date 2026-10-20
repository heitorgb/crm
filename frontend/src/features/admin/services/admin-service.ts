import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type {
  AddMemberInput,
  AdminTenantDetail,
  AdminTenantSummary,
  AdminUser,
  CreateTenantInput,
  UpdateMemberInput,
} from '@/types/admin';

export interface ListAdminParams {
  page?: number;
  perPage?: number;
  search?: string;
}

export const adminService = {
  listTenants: (params: ListAdminParams) =>
    apiRequest<PageResult<AdminTenantSummary>>(
      `/admin/tenants${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
      })}`,
    ),

  getTenant: (id: string) => apiRequest<AdminTenantDetail>(`/admin/tenants/${id}`),

  createTenant: (input: CreateTenantInput) =>
    apiRequest<AdminTenantDetail>('/admin/tenants', { method: 'POST', body: input }),

  updateWhatsAppLimit: (tenantId: string, whatsappInstanceLimit: number) =>
    apiRequest<AdminTenantDetail>(`/admin/tenants/${tenantId}/whatsapp-limit`, {
      method: 'PATCH',
      body: { whatsappInstanceLimit },
    }),

  addMember: (tenantId: string, input: AddMemberInput) =>
    apiRequest<AdminTenantDetail>(`/admin/tenants/${tenantId}/members`, {
      method: 'POST',
      body: input,
    }),

  updateMember: (tenantId: string, membershipId: string, input: UpdateMemberInput) =>
    apiRequest<AdminTenantDetail>(`/admin/tenants/${tenantId}/members/${membershipId}`, {
      method: 'PATCH',
      body: input,
    }),

  removeMember: (tenantId: string, membershipId: string) =>
    apiRequest<AdminTenantDetail>(`/admin/tenants/${tenantId}/members/${membershipId}`, {
      method: 'DELETE',
    }),

  listUsers: (params: ListAdminParams) =>
    apiRequest<PageResult<AdminUser>>(
      `/admin/users${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
      })}`,
    ),
};
