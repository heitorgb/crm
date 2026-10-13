import { useSyncExternalStore } from 'react';
import type { Socket } from 'socket.io-client';
import { realtimeStore } from '@/lib/realtime-store';

export function useRealtime(): { socket: Socket | null; connected: boolean } {
  const socket = useSyncExternalStore(realtimeStore.subscribe, realtimeStore.getSocket);
  const connected = useSyncExternalStore(realtimeStore.subscribe, realtimeStore.getConnected);
  return { socket, connected };
}
