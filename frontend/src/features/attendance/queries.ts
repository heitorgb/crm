import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attendanceService, type ListConversationsParams } from './services/attendance-service';

export const attendanceKeys = {
  all: ['attendance'] as const,
  conversations: (params: ListConversationsParams) =>
    ['attendance', 'conversations', params] as const,
  conversation: (id: string) => ['attendance', 'conversation', id] as const,
  messages: (id: string) => ['attendance', 'messages', id] as const,
};

export function useConversations(params: ListConversationsParams = {}) {
  return useQuery({
    queryKey: attendanceKeys.conversations(params),
    queryFn: () => attendanceService.listConversations(params),
    refetchInterval: 15000,
    placeholderData: (previous) => previous,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: attendanceKeys.conversation(id ?? ''),
    queryFn: () => attendanceService.getConversation(id as string),
    enabled: Boolean(id),
  });
}

export function useConversationMessages(id: string | undefined) {
  return useQuery({
    queryKey: attendanceKeys.messages(id ?? ''),
    queryFn: () => attendanceService.listMessages(id as string, 1, 100),
    enabled: Boolean(id),
    refetchInterval: 10000,
  });
}

export function useTakeoverConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceService.takeover(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
}

export function useCloseConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceService.close(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
}

export function useSendConversationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      attendanceService.sendMessage(id, content),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.messages(variables.id) });
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}
