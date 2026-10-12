import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddMemberInput,
  CreateTenantInput,
  UpdateMemberInput,
} from '@/types/admin';
import { adminService, type ListAdminParams } from './services/admin-service';

export const adminKeys = {
  all: ['admin'] as const,
  tenants: (params: ListAdminParams) => ['admin', 'tenants', params] as const,
  tenant: (id: string) => ['admin', 'tenant', id] as const,
  users: (params: ListAdminParams) => ['admin', 'users', params] as const,
};

export function useAdminTenants(params: ListAdminParams) {
  return useQuery({
    queryKey: adminKeys.tenants(params),
    queryFn: () => adminService.listTenants(params),
    placeholderData: (previous) => previous,
  });
}

export function useAdminTenant(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.tenant(id ?? ''),
    queryFn: () => adminService.getTenant(id as string),
    enabled: Boolean(id),
  });
}

export function useAdminUsers(params: ListAdminParams) {
  return useQuery({
    queryKey: adminKeys.users(params),
    queryFn: () => adminService.listUsers(params),
    placeholderData: (previous) => previous,
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTenantInput) => adminService.createTenant(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useAddMember(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMemberInput) => adminService.addMember(tenantId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useUpdateMember(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      membershipId,
      input,
    }: {
      membershipId: string;
      input: UpdateMemberInput;
    }) => adminService.updateMember(tenantId, membershipId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useRemoveMember(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => adminService.removeMember(tenantId, membershipId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}
