import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { authKeys } from '@/features/auth/queries';
import type { CreateMemberInput, UpdateMemberInput } from '@/types/settings';
import { settingsService } from './services/settings-service';

export const settingsKeys = {
  all: ['settings'] as const,
  organization: ['settings', 'organization'] as const,
  members: ['settings', 'members'] as const,
};

export function useOrganization() {
  return useQuery({
    queryKey: settingsKeys.organization,
    queryFn: () => settingsService.getOrganization(),
  });
}

export function useMembers() {
  return useQuery({
    queryKey: settingsKeys.members,
    queryFn: () => settingsService.listMembers(),
  });
}

export function useRenameOrganization() {
  const queryClient = useQueryClient();
  const updateTenantName = useAuthStore((state) => state.updateTenantName);

  return useMutation({
    mutationFn: (input: { name: string }) => settingsService.renameOrganization(input),
    onSuccess: (organization) => {
      updateTenantName(organization.name);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.organization });
      void queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export function useCreateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemberInput) => settingsService.createMember(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.members }),
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMemberInput }) =>
      settingsService.updateMember(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.members }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => settingsService.removeMember(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.members }),
  });
}
