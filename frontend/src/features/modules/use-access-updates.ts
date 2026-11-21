import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRealtime } from '@/providers/use-realtime';

/** Refetches everything when an admin changes this member's stores or modules, so menus and lists follow at once. */
export function useAccessUpdates(): void {
  const queryClient = useQueryClient();
  const { socket } = useRealtime();

  useEffect(() => {
    if (!socket) return;
    const refresh = (): void => {
      void queryClient.invalidateQueries();
    };
    socket.on('member.access-updated', refresh);
    return () => {
      socket.off('member.access-updated', refresh);
    };
  }, [socket, queryClient]);
}
