import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DealInput, DealStatus } from '@/types/sales';
import { dealsService, type ListDealsParams } from './services/deals-service';

export const dealKeys = {
  all: ['deals'] as const,
  list: (params: ListDealsParams) => ['deals', 'list', params] as const,
  board: (pipelineId: string) => ['deals', 'board', pipelineId] as const,
  detail: (id: string) => ['deals', 'detail', id] as const,
};

export function useDeals(params: ListDealsParams = {}) {
  return useQuery({
    queryKey: dealKeys.list(params),
    queryFn: () => dealsService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useDealBoard(pipelineId: string | undefined) {
  return useQuery({
    queryKey: dealKeys.board(pipelineId ?? ''),
    queryFn: () => dealsService.board(pipelineId as string),
    enabled: Boolean(pipelineId),
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DealInput) => dealsService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dealKeys.all }),
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<DealInput> }) =>
      dealsService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dealKeys.all }),
  });
}

export function useMoveDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      dealsService.move(id, stageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dealKeys.all }),
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dealsService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dealKeys.all }),
  });
}

export const DEAL_STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: 'OPEN', label: 'Aberto' },
  { value: 'WON', label: 'Ganho' },
  { value: 'LOST', label: 'Perdido' },
];
