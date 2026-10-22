import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequestBlob } from '@/lib/api-client';
import type { BulkMediaBatch } from '@/types/bulk-media';
import {
  attachmentPath,
  attendanceService,
  MESSAGES_PAGE_SIZE,
  type ListConversationsParams,
} from './services/attendance-service';

export const attendanceKeys = {
  all: ['attendance'] as const,
  conversations: (params: ListConversationsParams) =>
    ['attendance', 'conversations', params] as const,
  conversation: (id: string) => ['attendance', 'conversation', id] as const,
  unreadCount: ['attendance', 'unread-count'] as const,
  messages: (id: string) => ['attendance', 'messages', id] as const,
  historyMessages: (id: string) => ['attendance-history', 'messages', id] as const,
  participantAvatar: (conversationId: string, jid: string) =>
    ['attendance', 'participant-avatar', conversationId, jid] as const,
  linkPreview: (url: string) => ['attendance', 'link-preview', url] as const,
  photoBatch: (id: string) => ['attendance', 'photo-batch', id] as const,
  attachment: (
    conversationId: string,
    messageId: string,
    attachmentId: string,
    variant: 'main' | 'thumb',
  ) => ['attendance', 'attachment', conversationId, messageId, attachmentId, variant] as const,
};

export function useLinkPreview(url: string | null) {
  return useQuery({
    queryKey: attendanceKeys.linkPreview(url ?? ''),
    queryFn: async () => {
      const result = await attendanceService.resolveLinkPreviews([url as string]);
      return result.previews[0] ?? null;
    },
    enabled: Boolean(url),
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}

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

export function useUpdateConversationTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagIds }: { id: string; tagIds: string[] }) =>
      attendanceService.updateTags(id, tagIds),
    onSuccess: (conversation) => {
      queryClient.setQueryData(attendanceKeys.conversation(conversation.id), conversation);
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: attendanceKeys.unreadCount,
    queryFn: () => attendanceService.unreadCount(),
    refetchInterval: 30000,
  });
}

export function useConversationMessages(id: string | undefined) {
  return useQuery({
    queryKey: attendanceKeys.messages(id ?? ''),
    queryFn: () => attendanceService.listMessages(id as string, 1, MESSAGES_PAGE_SIZE),
    enabled: Boolean(id),
    refetchInterval: 10000,
  });
}

/**
 * Older history pages, loaded gradually as the operator scrolls up. It lives in
 * its own key namespace so realtime invalidations of the newest page never
 * refetch the whole history.
 */
export function useConversationHistoryMessages(id: string | undefined, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: attendanceKeys.historyMessages(id ?? ''),
    queryFn: ({ pageParam }) =>
      attendanceService.listMessages(id as string, pageParam, MESSAGES_PAGE_SIZE),
    initialPageParam: 2,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
    enabled: Boolean(id) && enabled,
    staleTime: Infinity,
  });
}

export function useParticipantAvatar(conversationId: string, jid: string | null) {
  return useQuery({
    queryKey: attendanceKeys.participantAvatar(conversationId, jid ?? ''),
    queryFn: () => attendanceService.resolveParticipantAvatar(conversationId, jid as string),
    enabled: Boolean(jid),
    staleTime: (query) => query.state.data?.url ? 30 * 60 * 1000 : 60 * 1000,
    refetchInterval: (query) => query.state.data?.url ? false : 60 * 1000,
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

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceService.deleteConversation(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: attendanceKeys.conversation(id) });
      queryClient.removeQueries({ queryKey: attendanceKeys.messages(id) });
      queryClient.removeQueries({ queryKey: attendanceKeys.historyMessages(id) });
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

export function useMarkConversationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceService.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.unreadCount });
    },
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
      linkPreview,
    }: {
      id: string;
      content: string;
      includeAgentName: boolean;
      quotedMessageId?: string;
      linkPreview?: boolean;
    }) =>
      attendanceService.sendMessage(
        id,
        content,
        includeAgentName,
        quotedMessageId,
        linkPreview,
      ),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.messages(variables.id) });
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

export function useRetryTranscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      messageId,
    }: {
      conversationId: string;
      messageId: string;
    }) => attendanceService.retryTranscription(conversationId, messageId),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: attendanceKeys.messages(variables.conversationId),
      });
    },
  });
}

export function useEditConversationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, messageId, content }: { id: string; messageId: string; content: string }) =>
      attendanceService.editMessage(id, messageId, content),
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
  gcTime?: number;
  retry?: boolean | number;
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
    gcTime: params.gcTime ?? Infinity,
    retry: params.retry,
  });
}

export function useSendPhotoBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      file: File;
      caption?: string;
      conversationIds: string[];
      idempotencyKey: string;
    }) => attendanceService.sendPhotoBatch(input),
    onSuccess: (batch) => {
      queryClient.setQueryData(attendanceKeys.photoBatch(batch.id), batch);
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

export function usePhotoBatch(id: string | null) {
  return useQuery({
    queryKey: attendanceKeys.photoBatch(id ?? ''),
    queryFn: () => attendanceService.getPhotoBatch(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = (query.state.data as BulkMediaBatch | undefined)?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 1500 : false;
    },
  });
}

export function useRetryPhotoBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceService.retryPhotoBatch(id),
    onSuccess: (batch) => {
      queryClient.setQueryData(attendanceKeys.photoBatch(batch.id), batch);
    },
  });
}
