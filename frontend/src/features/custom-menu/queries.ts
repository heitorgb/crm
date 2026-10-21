import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import type { SaveCustomMenuInput } from '@/types/custom-menu';
import { customMenuService } from './services/custom-menu-service';

export const customMenuKeys = {
  all: ['custom-menu'] as const,
  list: (tenantId: string) => ['custom-menu', 'list', tenantId] as const,
  navigation: (tenantId: string) => ['custom-menu', 'navigation', tenantId] as const,
};

export function useCustomMenu() {
  const tenantId = useAuthStore((state) => state.session?.tenant.id);

  return useQuery({
    queryKey: customMenuKeys.list(tenantId ?? ''),
    queryFn: () => customMenuService.list(),
    enabled: Boolean(tenantId),
    select: (data) => data.groups,
  });
}

export function useCustomMenuNavigation() {
  const tenantId = useAuthStore((state) => state.session?.tenant.id);

  return useQuery({
    queryKey: customMenuKeys.navigation(tenantId ?? ''),
    queryFn: () => customMenuService.navigation(),
    enabled: Boolean(tenantId),
    select: (data) => data.groups,
    staleTime: 30_000,
  });
}

export function useSaveCustomMenu() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SaveCustomMenuInput) => customMenuService.save(input),
    onSuccess: (data) => {
      const tenantId = useAuthStore.getState().session?.tenant.id;
      if (tenantId) {
        queryClient.setQueryData(customMenuKeys.list(tenantId), data);
        queryClient.setQueryData(customMenuKeys.navigation(tenantId), {
          groups: data.groups
            .filter((group) => group.active)
            .map((group) => ({
              ...group,
              buttons: group.buttons.filter((button) => button.active),
            }))
            .filter((group) => group.buttons.length > 0),
        });
      }
      void queryClient.invalidateQueries({ queryKey: customMenuKeys.all });
    },
  });
}
