import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { modulesService } from './services/modules-service';

export const modulesKeys = {
  all: ['modules'] as const,
  enabled: (tenantId: string) => ['modules', 'enabled', tenantId] as const,
  tenant: (tenantId: string) => ['modules', 'tenant', tenantId] as const,
};

export function useEnabledModules() {
  const tenantId = useAuthStore((state) => state.session?.tenant.id);

  return useQuery({
    queryKey: modulesKeys.enabled(tenantId ?? ''),
    queryFn: () => modulesService.getEnabled(),
    enabled: Boolean(tenantId),
    select: (data) => data.modules,
    staleTime: 30_000,
  });
}

export function useTenantModules(tenantId: string | undefined) {
  return useQuery({
    queryKey: modulesKeys.tenant(tenantId ?? ''),
    queryFn: () => modulesService.listTenantModules(tenantId as string),
    enabled: Boolean(tenantId),
  });
}

export function useUpdateTenantModule(tenantId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ moduleKey, enabled }: { moduleKey: string; enabled: boolean }) =>
      modulesService.updateTenantModule(tenantId as string, moduleKey, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modulesKeys.all });
    },
  });
}
