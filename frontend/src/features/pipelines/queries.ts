import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PipelineInput, PipelineStageInput } from '@/types/sales';
import { pipelinesService, type ListPipelinesParams } from './services/pipelines-service';

export const pipelineKeys = {
  all: ['pipelines'] as const,
  list: (params: ListPipelinesParams) => ['pipelines', 'list', params] as const,
  detail: (id: string) => ['pipelines', 'detail', id] as const,
  stages: (id: string) => ['pipelines', 'stages', id] as const,
};

export function usePipelines(params: ListPipelinesParams = {}) {
  return useQuery({
    queryKey: pipelineKeys.list(params),
    queryFn: () => pipelinesService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function usePipeline(id: string | undefined) {
  return useQuery({
    queryKey: pipelineKeys.detail(id ?? ''),
    queryFn: () => pipelinesService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PipelineInput) => pipelinesService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

export function useUpdatePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PipelineInput> }) =>
      pipelinesService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

export function useDeletePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pipelinesService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

export function useCreatePipelineStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, input }: { pipelineId: string; input: PipelineStageInput }) =>
      pipelinesService.createStage(pipelineId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

export function useUpdatePipelineStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      pipelineId,
      stageId,
      input,
    }: {
      pipelineId: string;
      stageId: string;
      input: Partial<PipelineStageInput>;
    }) => pipelinesService.updateStage(pipelineId, stageId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}

export function useDeletePipelineStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, stageId }: { pipelineId: string; stageId: string }) =>
      pipelinesService.removeStage(pipelineId, stageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pipelineKeys.all }),
  });
}
