import { apiRequest } from '@/lib/api-client';
import type { TenantModuleEntry } from '@/types/modules';

export const modulesService = {
  getEnabled: () => apiRequest<{ modules: string[] }>('/modules/enabled'),

  listTenantModules: (tenantId: string) =>
    apiRequest<TenantModuleEntry[]>(`/admin/tenants/${tenantId}/modules`),

  updateTenantModule: (tenantId: string, moduleKey: string, enabled: boolean) =>
    apiRequest<TenantModuleEntry>(`/admin/tenants/${tenantId}/modules/${moduleKey}`, {
      method: 'PATCH',
      body: { enabled },
    }),
};
