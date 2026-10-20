import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadInput } from '@/types/crm';
import { leadsService, type LeadBoardParams } from './services/leads-service';

export const leadKeys = {
  all: ['leads'] as const,
  pipelines: ['leads', 'pipelines'] as const,
  board: (params: LeadBoardParams) => ['leads', 'board', params] as const,
};

export function useLeadPipelines() {
  return useQuery({ queryKey: leadKeys.pipelines, queryFn: leadsService.pipelines });
}

export function useLeadBoard(params: LeadBoardParams) {
  return useQuery({
    queryKey: leadKeys.board(params),
    queryFn: () => leadsService.board(params),
    enabled: Boolean(params.pipelineId),
    placeholderData: (previous) => previous,
  });
}

function useInvalidateLeads() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: leadKeys.all });
}

export function useCreateLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({ mutationFn: (input: LeadInput) => leadsService.create(input), onSuccess: invalidate });
}

export function useUpdateLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<LeadInput, 'pipelineId'>> }) =>
      leadsService.update(id, input),
    onSuccess: invalidate,
  });
}

export function useMoveLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) => leadsService.move(id, stageId),
    onSuccess: invalidate,
  });
}

export function useDeleteLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({ mutationFn: leadsService.remove, onSuccess: invalidate });
}

export function useCreateLeadPipeline() {
  const invalidate = useInvalidateLeads();
  return useMutation({ mutationFn: leadsService.createPipeline, onSuccess: invalidate });
}

export function useUpdateLeadPipeline() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; description?: string | null; active?: boolean } }) => leadsService.updatePipeline(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateLeadStage() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ pipelineId, input }: { pipelineId: string; input: { name: string; color?: string; kind?: string } }) => leadsService.createStage(pipelineId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateLeadStage() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ pipelineId, stageId, input }: { pipelineId: string; stageId: string; input: { name?: string; color?: string; kind?: string } }) => leadsService.updateStage(pipelineId, stageId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteLeadStage() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ pipelineId, stageId }: { pipelineId: string; stageId: string }) => leadsService.removeStage(pipelineId, stageId),
    onSuccess: invalidate,
  });
}
