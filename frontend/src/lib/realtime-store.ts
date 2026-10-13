import { io, type Socket } from 'socket.io-client';
import { refreshSession } from './session-refresh';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Listener = () => void;

let socket: Socket | null = null;
let connected = true;
let currentToken: string | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function connect(token: string): void {
  if (socket && currentToken === token) {
    return;
  }

  currentToken = token;
  socket?.disconnect();

  const instance = io(`${BASE_URL}/realtime`, {
    path: '/socket.io',
    auth: { token },
    transports: ['polling', 'websocket'],
  });
  socket = instance;
  connected = true;

  instance.on('connect', () => {
    connected = true;
    notify();
  });
  instance.on('disconnect', () => {
    connected = false;
    notify();
  });
  instance.on('connect_error', () => {
    connected = false;
    void refreshSession();
    notify();
  });

  notify();
}

function disconnect(): void {
  currentToken = null;
  socket?.disconnect();
  socket = null;
  connected = true;
  notify();
}

export const realtimeStore = {
  connect,
  disconnect,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSocket(): Socket | null {
    return socket;
  },
  getConnected(): boolean {
    return connected;
  },
};
