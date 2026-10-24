import { useEffect, useState } from 'react';
import { formatLastSeen } from './attendance-utils';
import { useRealtime } from '@/providers/use-realtime';
import type { ConversationPresence, ConversationPresenceState } from '@/types/attendance';

export const PRESENCE_ACTIVITY_TTL_MS = 12_000;
export const PRESENCE_ONLINE_TTL_MS = 2 * 60 * 1000;

const PRESENCE_STATES: ReadonlySet<ConversationPresenceState> = new Set([
  'online',
  'offline',
  'composing',
  'recording',
]);

const EMPTY_PRESENCE: ConversationPresence = {
  state: 'unknown',
  participantId: null,
  participantName: null,
  participantPhone: null,
  lastSeenAt: null,
  occurredAt: null,
  receivedAt: null,
};

interface PresencePayload {
  conversationId?: unknown;
  state?: unknown;
  participantId?: unknown;
  participantName?: unknown;
  participantPhone?: unknown;
  lastSeenAt?: unknown;
  occurredAt?: unknown;
  receivedAt?: unknown;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readDate(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function parsePresence(conversationId: string, payload: unknown): ConversationPresence | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as PresencePayload;
  if (record.conversationId !== conversationId) {
    return null;
  }
  if (typeof record.state !== 'string' || !PRESENCE_STATES.has(record.state as ConversationPresenceState)) {
    return null;
  }

  return {
    state: record.state as ConversationPresenceState,
    participantId: readString(record.participantId),
    participantName: readString(record.participantName),
    participantPhone: readString(record.participantPhone),
    lastSeenAt: readString(record.lastSeenAt),
    occurredAt: readString(record.occurredAt),
    receivedAt: readString(record.receivedAt),
  };
}

function isStale(current: ConversationPresence, next: ConversationPresence): boolean {
  const currentTime = readDate(current.occurredAt);
  const nextTime = readDate(next.occurredAt);
  return currentTime !== null && nextTime !== null && nextTime < currentTime;
}

function isOtherParticipantClearingActivity(
  current: ConversationPresence,
  next: ConversationPresence,
): boolean {
  return (
    (current.state === 'composing' || current.state === 'recording') &&
    next.state === 'online' &&
    current.participantId !== null &&
    next.participantId !== null &&
    current.participantId !== next.participantId
  );
}

function withExpiration(
  current: ConversationPresence,
  next: ConversationPresence,
): ConversationPresence {
  if (isStale(current, next) || isOtherParticipantClearingActivity(current, next)) {
    return current;
  }
  return next;
}

interface PresenceRecord {
  conversationId: string;
  presence: ConversationPresence;
}

export function useConversationPresence(conversationId: string): ConversationPresence {
  const { socket } = useRealtime();
  const [record, setRecord] = useState<PresenceRecord>(() => ({
    conversationId,
    presence: EMPTY_PRESENCE,
  }));

  const presence =
    record.conversationId === conversationId ? record.presence : EMPTY_PRESENCE;

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handlePresence = (payload: unknown): void => {
      const next = parsePresence(conversationId, payload);
      if (!next) {
        return;
      }
      setRecord((current) => {
        const currentPresence =
          current.conversationId === conversationId ? current.presence : EMPTY_PRESENCE;
        const nextPresence = withExpiration(currentPresence, next);
        return nextPresence === currentPresence
          ? current
          : { conversationId, presence: nextPresence };
      });
    };

    socket.on('conversation.presence', handlePresence);
    return () => {
      socket.off('conversation.presence', handlePresence);
    };
  }, [conversationId, socket]);

  useEffect(() => {
    if (!presence.occurredAt) {
      return;
    }
    if (presence.state !== 'composing' && presence.state !== 'recording' && presence.state !== 'online') {
      return;
    }

    const receivedAt = readDate(presence.receivedAt ?? presence.occurredAt);
    if (receivedAt === null) {
      return;
    }

    const ttl =
      presence.state === 'online' ? PRESENCE_ONLINE_TTL_MS : PRESENCE_ACTIVITY_TTL_MS;
    const delay = Math.max(0, receivedAt + ttl - Date.now());
    const timer = window.setTimeout(() => {
      setRecord((current) =>
        current.conversationId === conversationId &&
        current.presence.occurredAt === presence.occurredAt
          ? {
              conversationId,
              presence: { ...EMPTY_PRESENCE, occurredAt: current.presence.occurredAt },
            }
          : current,
      );
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [conversationId, presence]);

  return presence;
}

function participantLabel(presence: ConversationPresence): string | null {
  return presence.participantName ?? presence.participantPhone ?? presence.participantId;
}

export function presenceLabel(
  presence: ConversationPresence,
  isGroup: boolean,
): string {
  const participant = participantLabel(presence);
  switch (presence.state) {
    case 'composing':
      return participant ? `${participant} digitando...` : 'digitando...';
    case 'recording':
      return participant ? `${participant} gravando áudio...` : 'gravando áudio...';
    case 'online':
      return isGroup && participant ? `${participant} online` : 'Online';
    case 'offline':
      return presence.lastSeenAt
        ? `Visto por último ${formatLastSeen(presence.lastSeenAt)}`
        : 'Offline';
    default:
      return 'Status indisponível';
  }
}

