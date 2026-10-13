import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequestBlob } from '@/lib/api-client';
import {
  attachmentPath,
  attendanceService,
  type ListConversationsParams,
} from './services/attendance-service';

export const attendanceKeys = {
  all: ['attendance'] as const,
  conversations: (params: ListConversationsParams) =>
    ['attendance', 'conversations', params] as const,
  conversation: (id: string) => ['attendance', 'conversation', id] as const,
  messages: (id: string) => ['attendance', 'messages', id] as const,
  participantAvatar: (conversationId: string, jid: string) =>
    ['attendance', 'participant-avatar', conversationId, jid] as const,
  attachment: (
    conversationId: string,
    messageId: string,
    attachmentId: string,
    variant: 'main' | 'thumb',
  ) => ['attendance', 'attachment', conversationId, messageId, attachmentId, variant] as const,
};

export function useConversations(params: ListConversationsParams = {}) {
  return useQuery({
    queryKey: attendanceKeys.conversations(params),
    queryFn: () => attendanceService.listConversations(params),
    refetchInterval: 15000,
    placeholderData: (previous, previousQuery) => {
      const previousParams = previousQuery?.queryKey[2] as ListConversationsParams | undefined;
      return previousParams?.archived === params.archived ? previous : undefined;
    },
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

export function useParticipantAvatar(conversationId: string, jid: string | null) {
  return useQuery({
    queryKey: attendanceKeys.participantAvatar(conversationId, jid ?? ''),
    queryFn: () => attendanceService.resolveParticipantAvatar(conversationId, jid as string),
    enabled: Boolean(jid),
    staleTime: 30 * 60 * 1000,
  });
}

export function useTakeoverConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceService.takeover(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
}

export function useStartConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contactId: string; whatsappInstanceId: string }) =>
      attendanceService.startConversation(input),
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

export function useSetConversationPinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? attendanceService.pin(id) : attendanceService.unpin(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
}

export function useSetConversationArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      archived ? attendanceService.archive(id) : attendanceService.unarchive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
}

export function useRefreshGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceService.refreshGroup(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
}

export function useSendConversationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      content,
      includeAgentName,
      quotedMessageId,
    }: {
      id: string;
      content: string;
      includeAgentName: boolean;
      quotedMessageId?: string;
    }) => attendanceService.sendMessage(id, content, includeAgentName, quotedMessageId),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.messages(variables.id) });
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

export function useSendConversationMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      file,
      caption,
      includeAgentName,
      quotedMessageId,
    }: {
      id: string;
      file: File;
      caption?: string;
      includeAgentName: boolean;
      quotedMessageId?: string;
    }) => attendanceService.sendMedia(id, file, caption, includeAgentName, quotedMessageId),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.messages(variables.id) });
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

export function useAttachmentBlob(params: {
  conversationId: string;
  messageId: string;
  attachmentId: string;
  variant: 'main' | 'thumb';
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: attendanceKeys.attachment(
      params.conversationId,
      params.messageId,
      params.attachmentId,
      params.variant,
    ),
    queryFn: () =>
      apiRequestBlob(
        attachmentPath(
          params.conversationId,
          params.messageId,
          params.attachmentId,
          params.variant,
        ),
      ),
    enabled: params.enabled ?? true,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
