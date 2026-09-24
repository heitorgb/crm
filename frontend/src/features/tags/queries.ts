import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerKeys } from '@/features/customers/queries';
import type { TagInput } from '@/types/crm';
import { tagsService, type ListTagsParams } from './services/tags-service';

export const tagKeys = {
  all: ['tags'] as const,
  list: (params: ListTagsParams) => ['tags', 'list', params] as const,
  detail: (id: string) => ['tags', 'detail', id] as const,
};

export function useTags(params: ListTagsParams = {}) {
  return useQuery({
    queryKey: tagKeys.list(params),
    queryFn: () => tagsService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TagInput) => tagsService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TagInput> }) =>
      tagsService.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => tagsService.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
