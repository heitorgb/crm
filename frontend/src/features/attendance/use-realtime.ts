import { useEffect, useRef } from 'react';
import { useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { useRealtime } from '@/providers/use-realtime';
import type { ConversationMessage, MessageReaction } from '@/types/attendance';
import type { PageResult } from '@/types/crm';
import { attendanceKeys } from './queries';

interface ConversationEventPayload {
  conversationId?: unknown;
  messageId?: unknown;
}

interface MessageReactionEventPayload extends ConversationEventPayload {
  reactions?: unknown;
}

function readMessageId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const value = (payload as ConversationEventPayload).messageId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readReactions(payload: unknown): MessageReaction[] | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const value = (payload as MessageReactionEventPayload).reactions;
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter(
    (reaction): reaction is MessageReaction =>
      typeof reaction === 'object' &&
      reaction !== null &&
      typeof (reaction as MessageReaction).id === 'string' &&
      typeof (reaction as MessageReaction).emoji === 'string' &&
      typeof (reaction as MessageReaction).reactorId === 'string',
  );
}

function withReactions(
  page: PageResult<ConversationMessage>,
  messageId: string,
  reactions: MessageReaction[],
): PageResult<ConversationMessage> {
  let changed = false;
  const data = page.data.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    changed = true;
    return { ...message, reactions };
  });
  return changed ? { ...page, data } : page;
}

function withReactionsInPages(
  data: InfiniteData<PageResult<ConversationMessage>>,
  messageId: string,
  reactions: MessageReaction[],
): InfiniteData<PageResult<ConversationMessage>> {
  let changed = false;
  const pages = data.pages.map((page) => {
    const next = withReactions(page, messageId, reactions);
    if (next !== page) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...data, pages } : data;
}

function readConversationId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const value = (payload as ConversationEventPayload).conversationId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function hasMessageId(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const value = (payload as ConversationEventPayload).messageId;
  return typeof value === 'string' && value.length > 0;
}

export function useAttendanceRealtime(
  activeConversationId: string | null = null,
): { connected: boolean } {
  const { socket, connected } = useRealtime();
  const queryClient = useQueryClient();
  const activeConversationIdRef = useRef(activeConversationId);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const invalidate = (queryKey: QueryKey): void => {
      void queryClient.invalidateQueries({ queryKey });
    };

    const invalidateConversationList = (): void => {
      invalidate(attendanceKeys.conversationLists);
    };

    const invalidateActiveConversation = (): void => {
      const activeId = activeConversationIdRef.current;
      if (activeId) {
        invalidate(attendanceKeys.conversation(activeId));
      }
    };

    const invalidateActiveMessages = (): void => {
      const activeId = activeConversationIdRef.current;
      if (activeId) {
        invalidate(attendanceKeys.messages(activeId));
      }
    };

    const handleMessage = (payload: unknown): void => {
      const conversationId = readConversationId(payload);
      if (!conversationId) {
        return;
      }
      invalidateConversationList();
      if (conversationId !== activeConversationIdRef.current) {
        return;
      }
      invalidateActiveConversation();
      invalidateActiveMessages();
    };

    const handleConversationUpdated = (payload: unknown): void => {
      const conversationId = readConversationId(payload);
      if (!conversationId) {
        return;
      }
      invalidateConversationList();
      if (conversationId !== activeConversationIdRef.current) {
        return;
      }
      invalidateActiveConversation();
      if (hasMessageId(payload)) {
        invalidateActiveMessages();
      }
    };

    const handleMessageReaction = (payload: unknown): void => {
      const conversationId = readConversationId(payload);
      const messageId = readMessageId(payload);
      const reactions = readReactions(payload);
      if (!conversationId || !messageId || !reactions) {
        return;
      }

      queryClient.setQueryData<PageResult<ConversationMessage>>(
        attendanceKeys.messages(conversationId),
        (current) => (current ? withReactions(current, messageId, reactions) : current),
      );
      queryClient.setQueryData<InfiniteData<PageResult<ConversationMessage>>>(
        attendanceKeys.historyMessages(conversationId),
        (current) =>
          current ? withReactionsInPages(current, messageId, reactions) : current,
      );
    };

    const handleConversationDeleted = (payload: unknown): void => {
      const conversationId = readConversationId(payload);
      if (!conversationId) {
        return;
      }
      invalidateConversationList();
      if (conversationId !== activeConversationIdRef.current) {
        return;
      }
      invalidateActiveConversation();
      invalidateActiveMessages();
    };

    const handleConnect = (): void => {
      invalidateConversationList();
      invalidate(attendanceKeys.unreadCount);
      invalidateActiveConversation();
      invalidateActiveMessages();
    };

    socket.on('connect', handleConnect);
    socket.on('message.created', handleMessage);
    socket.on('message.updated', handleMessage);
    socket.on('message.reaction', handleMessageReaction);
    socket.on('conversation.updated', handleConversationUpdated);
    socket.on('conversation.deleted', handleConversationDeleted);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('message.created', handleMessage);
      socket.off('message.updated', handleMessage);
      socket.off('message.reaction', handleMessageReaction);
      socket.off('conversation.updated', handleConversationUpdated);
      socket.off('conversation.deleted', handleConversationDeleted);
    };
  }, [socket, queryClient]);

  return { connected };
}
