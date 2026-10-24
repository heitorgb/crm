// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtime } from '@/providers/use-realtime';
import type { ConversationPresence } from '@/types/attendance';
import { ConversationPresenceIndicator } from './conversation-presence';
import {
  PRESENCE_ACTIVITY_TTL_MS,
  PRESENCE_ONLINE_TTL_MS,
  presenceLabel,
} from './use-conversation-presence';

vi.mock('@/providers/use-realtime', () => ({
  useRealtime: vi.fn(),
}));

type Listener = (payload?: unknown) => void;

class FakeSocket {
  private readonly listeners = new Map<string, Set<Listener>>();

  on = vi.fn((event: string, listener: Listener): this => {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  });

  off = vi.fn((event: string, listener: Listener): this => {
    this.listeners.get(event)?.delete(listener);
    return this;
  });

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

function presenceEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    conversationId: CONVERSATION_ID,
    participantId: '5511999999999@s.whatsapp.net',
    participantName: 'Ana',
    participantPhone: '5511999999999',
    state: 'online',
    lastSeenAt: null,
    occurredAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderIndicator(isGroup = false) {
  return render(
    <ConversationPresenceIndicator conversationId={CONVERSATION_ID} isGroup={isGroup} />,
  );
}

function emit(payload: unknown): void {
  act(() => {
    socket.emit('conversation.presence', payload);
  });
}

let socket: FakeSocket;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
  socket = new FakeSocket();
  vi.mocked(useRealtime).mockReturnValue({ socket: socket as never, connected: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ConversationPresenceIndicator', () => {
  it('shows online only after a confirmed presence event', () => {
    renderIndicator();
    expect(screen.getByText('Status indisponível')).toBeTruthy();

    emit(presenceEvent({ state: 'online' }));
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('shows typing and recording activity with the participant name', () => {
    renderIndicator(true);

    emit(presenceEvent({ state: 'composing' }));
    expect(screen.getByText('Ana digitando...')).toBeTruthy();

    emit(presenceEvent({ state: 'recording' }));
    expect(screen.getByText('Ana gravando áudio...')).toBeTruthy();
  });

  it('shows last seen only when a timestamp is provided', () => {
    renderIndicator();
    const lastSeenAt = new Date(2026, 9, 24, 14, 35).toISOString();

    emit(presenceEvent({ state: 'offline', lastSeenAt }));
    expect(screen.getByText(/Visto por último/)).toBeTruthy();
    expect(screen.getByText(/14:35/)).toBeTruthy();

    emit(
      presenceEvent({
        state: 'offline',
        lastSeenAt: null,
        occurredAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('ignores presence from another conversation', () => {
    renderIndicator();

    emit(presenceEvent({ conversationId: OTHER_CONVERSATION_ID, state: 'online' }));

    expect(screen.getByText('Status indisponível')).toBeTruthy();
  });

  it('clears typing when the same participant reports available', () => {
    renderIndicator();

    emit(presenceEvent({ state: 'composing' }));
    expect(screen.getByText('Ana digitando...')).toBeTruthy();

    emit(
      presenceEvent({
        state: 'online',
        occurredAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('does not let another participant stop an active typing indicator', () => {
    renderIndicator(true);

    emit(presenceEvent({ state: 'composing', participantName: 'Ana' }));
    emit(
      presenceEvent({
        state: 'online',
        participantId: '5511888888888@s.whatsapp.net',
        participantName: 'Bruno',
        occurredAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );

    expect(screen.getByText('Ana digitando...')).toBeTruthy();
  });

  it('ignores out-of-order events', () => {
    renderIndicator();

    emit(presenceEvent({ state: 'offline', occurredAt: '2026-10-24T12:00:10.000Z' }));
    emit(presenceEvent({ state: 'online', occurredAt: '2026-10-24T12:00:00.000Z' }));

    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('expires a typing indicator when the closing event never arrives', () => {
    renderIndicator();

    emit(presenceEvent({ state: 'composing' }));
    act(() => {
      vi.advanceTimersByTime(PRESENCE_ACTIVITY_TTL_MS + 1);
    });

    expect(screen.getByText('Status indisponível')).toBeTruthy();
  });

  it('expires an online indicator so old state is not presented as current', () => {
    renderIndicator();

    emit(presenceEvent({ state: 'online' }));
    act(() => {
      vi.advanceTimersByTime(PRESENCE_ONLINE_TTL_MS + 1);
    });

    expect(screen.getByText('Status indisponível')).toBeTruthy();
  });

  it('keeps offline/last seen until a newer event arrives', () => {
    renderIndicator();

    emit(presenceEvent({ state: 'offline' }));
    act(() => {
      vi.advanceTimersByTime(PRESENCE_ONLINE_TTL_MS * 4);
    });

    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('does not expose technical participant identifiers when the name is unknown', () => {
    renderIndicator(true);

    emit(
      presenceEvent({
        state: 'recording',
        participantId: '63604221026389@lid',
        participantName: null,
        participantPhone: null,
      }),
    );

    expect(screen.getByText('gravando áudio...')).toBeTruthy();
    expect(screen.queryByText(/63604221026389@lid/)).toBeNull();
  });

  it('formats labels independently from the component state', () => {
    const base: ConversationPresence = {
      state: 'unknown',
      participantId: null,
      participantName: null,
      participantPhone: null,
      lastSeenAt: null,
      occurredAt: null,
      receivedAt: null,
    };
    expect(presenceLabel(base, false)).toBe('Status indisponível');
    expect(presenceLabel({ ...base, state: 'composing' }, false)).toBe('digitando...');
    expect(presenceLabel({ ...base, state: 'recording' }, true)).toBe('gravando áudio...');
    expect(
      presenceLabel({ ...base, state: 'online', participantName: 'Ana' }, true),
    ).toBe('Ana online');
    expect(
      presenceLabel(
        { ...base, state: 'recording', participantId: '63604221026389@lid' },
        true,
      ),
    ).toBe('gravando áudio...');
  });
});
