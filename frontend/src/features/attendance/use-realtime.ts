import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRealtime } from '@/providers/use-realtime';
import { attendanceKeys } from './queries';

interface ConversationEventPayload {
  conversationId?: unknown;
  messageId?: unknown;
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
    socket.on('conversation.updated', handleConversationUpdated);
    socket.on('conversation.deleted', handleConversationDeleted);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('message.created', handleMessage);
      socket.off('message.updated', handleMessage);
      socket.off('conversation.updated', handleConversationUpdated);
      socket.off('conversation.deleted', handleConversationDeleted);
    };
  }, [socket, queryClient]);

  return { connected };
}
