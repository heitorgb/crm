import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';
import { attendanceKeys } from './queries';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function useAttendanceRealtime(): { connected: boolean } {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.session?.accessToken);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    if (!token) {
      return;
    }

    const socket = io(`${BASE_URL}/realtime`, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
    });
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    };

    socket.on('connect', () => {
      setConnected(true);
      invalidate();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('message.created', invalidate);
    socket.on('conversation.updated', invalidate);

    return () => {
      socket.disconnect();
    };
  }, [token, queryClient]);

  return { connected };
}
