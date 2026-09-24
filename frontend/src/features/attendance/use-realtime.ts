import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';
import { attendanceKeys } from './queries';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function useAttendanceRealtime(): Record<string, string> {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.session?.accessToken);
  const [presence, setPresence] = useState<{ token: string; labels: Record<string, string> } | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    const socket = io(`${BASE_URL}/realtime`, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
    });
    const entries = new Map<string, { conversationId: string; state: string; expiresAt: number }>();
    const publish = () => {
      const labels: Record<string, string> = {};
      for (const entry of entries.values()) {
        if (entry.state === 'recording') labels[entry.conversationId] = 'gravando áudio…';
        else labels[entry.conversationId] ??= 'digitando…';
      }
      setPresence({ token, labels });
    };
    const clear = () => { entries.clear(); publish(); };
    socket.on('conversation.presence', (event: unknown) => {
      if (typeof event !== 'object' || event === null) return;
      const { conversationId, participantId, state } = event as Record<string, unknown>;
      if (typeof conversationId !== 'string' || typeof participantId !== 'string' || typeof state !== 'string') return;
      const key = `${conversationId}:${participantId}`;
      if (state === 'composing' || state === 'recording') {
        entries.set(key, { conversationId, state, expiresAt: Date.now() + 10000 });
      } else {
        entries.delete(key);
      }
      publish();
    });
    const expiry = window.setInterval(() => {
      let changed = false;
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= Date.now()) { entries.delete(key); changed = true; }
      }
      if (changed) publish();
    }, 1000);
    socket.on('disconnect', clear);

    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    };

    socket.on('connect', invalidate);
    socket.on('message.created', invalidate);
    socket.on('conversation.updated', invalidate);

    return () => {
      window.clearInterval(expiry);
      socket.off('disconnect', clear);
      socket.disconnect();
    };
  }, [token, queryClient]);
  return presence?.token === token ? presence?.labels ?? {} : {};
}
