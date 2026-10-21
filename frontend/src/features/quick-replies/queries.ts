import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuickReplyInput } from '@/types/quick-replies';
import {
  quickRepliesService,
  type ListQuickRepliesParams,
} from './services/quick-replies-service';

export const quickReplyKeys = {
  all: ['quick-replies'] as const,
  list: (params: ListQuickRepliesParams) => ['quick-replies', 'list', params] as const,
  detail: (id: string) => ['quick-replies', 'detail', id] as const,
};

export function useQuickReplies(
  params: ListQuickRepliesParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: quickReplyKeys.list(params),
    queryFn: () => quickRepliesService.list(params),
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
  });
}

export function useCreateQuickReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: QuickReplyInput) => quickRepliesService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quickReplyKeys.all }),
  });
}

export function useUpdateQuickReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<QuickReplyInput> }) =>
      quickRepliesService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quickReplyKeys.all }),
  });
}

export function useDeleteQuickReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => quickRepliesService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quickReplyKeys.all }),
  });
}
