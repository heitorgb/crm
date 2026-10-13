import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { playNotificationSound, primeNotificationSound } from '@/lib/notification-sound';
import { attendanceKeys, useUnreadCount } from '@/features/attendance/queries';
import { useNotificationStore } from '@/stores/notification-store';
import { useRealtime } from '@/providers/use-realtime';

const BASE_TITLE = 'OrderUp CRM';
const ATTENDANCE_PATH = '/atendimento/conversas';

interface MessageCreatedPayload {
  conversationId?: string;
  messageId?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
}

/**
 * Keeps the browser tab badge and the notification sound in sync with inbound
 * messages, everywhere in the app (not only on the attendance screen). The tab
 * counter is read from the persisted server state, never from local storage.
 */
export function useMessageNotifications(): void {
  const { socket } = useRealtime();
  const location = useLocation();
  const queryClient = useQueryClient();

  const tabBadgeEnabled = useNotificationStore((state) => state.tabBadgeEnabled);
  const soundEnabled = useNotificationStore((state) => state.soundEnabled);
  const unreadCount = useUnreadCount().data?.total ?? 0;

  const onAttendance = location.pathname === ATTENDANCE_PATH;
  const activeConversationId = new URLSearchParams(location.search).get('conversation');

  useEffect(() => {
    document.title =
      tabBadgeEnabled && unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [tabBadgeEnabled, unreadCount]);

  useEffect(() => {
    const prime = (): void => primeNotificationSound();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const refreshUnread = (): void => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.unreadCount });
    };

    const handleMessage = (payload: MessageCreatedPayload): void => {
      if (payload?.direction !== 'INBOUND' || !payload.conversationId) {
        return;
      }
      refreshUnread();
      const isOpen = onAttendance && activeConversationId === payload.conversationId;
      if (isOpen) {
        return;
      }

      if (soundEnabled) {
        playNotificationSound();
      }
    };

    socket.on('message.created', handleMessage);
    socket.on('conversation.updated', refreshUnread);
    return () => {
      socket.off('message.created', handleMessage);
      socket.off('conversation.updated', refreshUnread);
    };
  }, [socket, onAttendance, activeConversationId, soundEnabled, queryClient]);
}
