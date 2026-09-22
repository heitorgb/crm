import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadInput, LeadStatus } from '@/types/sales';
import { leadsService, type ListLeadsParams } from './services/leads-service';

export const leadKeys = {
  all: ['leads'] as const,
  list: (params: ListLeadsParams) => ['leads', 'list', params] as const,
  detail: (id: string) => ['leads', 'detail', id] as const,
};

export function useLeads(params: ListLeadsParams = {}) {
  return useQuery({
    queryKey: leadKeys.list(params),
    queryFn: () => leadsService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: leadKeys.detail(id ?? ''),
    queryFn: () => leadsService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadInput) => leadsService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadKeys.all }),
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<LeadInput> }) =>
      leadsService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadKeys.all }),
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => leadsService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadKeys.all }),
  });
}

export const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'NEW', label: 'Novo' },
  { value: 'QUALIFYING', label: 'Em qualificação' },
  { value: 'QUALIFIED_WAITING_DIGEST', label: 'Qualificado' },
  { value: 'DISQUALIFIED', label: 'Desqualificado' },
  { value: 'NEEDS_HUMAN', label: 'Requer humano' },
  { value: 'ASSIGNED', label: 'Atribuído' },
];
