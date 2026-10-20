import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScheduledMessageInput } from '@/types/scheduled-messages';
import {
  scheduledMessagesService,
  type ListScheduledMessagesParams,
} from './services/scheduled-messages-service';

export const scheduledMessageKeys = {
  all: ['scheduled-messages'] as const,
  list: (params: ListScheduledMessagesParams) => ['scheduled-messages', 'list', params] as const,
  detail: (id: string) => ['scheduled-messages', 'detail', id] as const,
  logs: (id: string) => ['scheduled-messages', 'logs', id] as const,
  recipients: (id: string) => ['scheduled-messages', 'recipients', id] as const,
};

function invalidate(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: scheduledMessageKeys.all });
}

export function useScheduledMessages(params: ListScheduledMessagesParams) {
  return useQuery({
    queryKey: scheduledMessageKeys.list(params),
    queryFn: () => scheduledMessagesService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useScheduledMessage(id: string | undefined) {
  return useQuery({
    queryKey: scheduledMessageKeys.detail(id ?? ''),
    queryFn: () => scheduledMessagesService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useScheduledMessageLogs(id: string | undefined) {
  return useQuery({
    queryKey: scheduledMessageKeys.logs(id ?? ''),
    queryFn: () => scheduledMessagesService.logs(id as string),
    enabled: Boolean(id),
  });
}

export function useScheduledMessageRecipients(id: string | undefined) {
  return useQuery({
    queryKey: scheduledMessageKeys.recipients(id ?? ''),
    queryFn: () => scheduledMessagesService.recipients(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateScheduledMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduledMessageInput) => scheduledMessagesService.create(input),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateScheduledMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ScheduledMessageInput }) =>
      scheduledMessagesService.update(id, input),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: scheduledMessageKeys.detail(variables.id),
      });
      invalidate(queryClient);
    },
  });
}

export function useCancelScheduledMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => scheduledMessagesService.cancel(id),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDuplicateScheduledMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt?: string }) =>
      scheduledMessagesService.duplicate(id, scheduledAt),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRetryScheduledMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledFor }: { id: string; scheduledFor?: string }) =>
      scheduledMessagesService.retry(id, scheduledFor),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: scheduledMessageKeys.logs(variables.id) });
      invalidate(queryClient);
    },
  });
}
