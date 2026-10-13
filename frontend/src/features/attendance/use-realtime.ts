import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRealtime } from '@/providers/use-realtime';
import { attendanceKeys } from './queries';

export function useAttendanceRealtime(): { connected: boolean } {
  const { socket, connected } = useRealtime();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) {
      return;
    }

    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    };

    socket.on('connect', invalidate);
    socket.on('message.created', invalidate);
    socket.on('message.updated', invalidate);
    socket.on('conversation.updated', invalidate);

    return () => {
      socket.off('connect', invalidate);
      socket.off('message.created', invalidate);
      socket.off('message.updated', invalidate);
      socket.off('conversation.updated', invalidate);
    };
  }, [socket, queryClient]);

  return { connected };
}
