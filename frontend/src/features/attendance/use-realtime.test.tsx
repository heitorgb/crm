// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtime } from '@/providers/use-realtime';
import { attendanceKeys } from './queries';
import { useAttendanceRealtime } from './use-realtime';

vi.mock('@/providers/use-realtime', () => ({
  useRealtime: vi.fn(),
}));

type Listener = (payload?: unknown) => void;

class FakeSocket {
  private readonly listeners = new Map<string, Set<Listener>>();

  on = vi.fn((event: string, listener: Listener): this => {
    const eventListeners = this.listeners.get(event) ?? new Set<Listener>();
    eventListeners.add(listener);
    this.listeners.set(event, eventListeners);
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

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

const ACTIVE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

let socket: FakeSocket;
let queryClient: QueryClient;
let invalidateQueries: ReturnType<typeof vi.spyOn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderRealtime(activeConversationId: string | null = ACTIVE_ID) {
  return renderHook(() => useAttendanceRealtime(activeConversationId), { wrapper });
}

function invalidatedKeys(): unknown[] {
  return invalidateQueries.mock.calls.map((call: unknown) => {
    const filters = (call as unknown[])[0] as { queryKey?: unknown } | undefined;
    return filters?.queryKey;
  });
}

function expectInvalidated(key: readonly unknown[]): void {
  expect(invalidatedKeys()).toContainEqual(key);
}

function expectNotInvalidated(key: readonly unknown[]): void {
  expect(invalidatedKeys()).not.toContainEqual(key);
}

beforeEach(() => {
  socket = new FakeSocket();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateQueries = vi
    .spyOn(queryClient, 'invalidateQueries')
    .mockResolvedValue(undefined);
  vi.mocked(useRealtime).mockReturnValue({ socket: socket as never, connected: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAttendanceRealtime invalidation scope', () => {
  it('updates the conversation list for another conversation without touching the active chat', () => {
    renderRealtime();

    act(() => {
      socket.emit('message.created', {
        conversationId: OTHER_ID,
        messageId: 'message-b',
        direction: 'INBOUND',
      });
    });

    expectInvalidated(attendanceKeys.conversationLists);
    expectNotInvalidated(attendanceKeys.conversation(ACTIVE_ID));
    expectNotInvalidated(attendanceKeys.messages(ACTIVE_ID));
    expect(
      invalidatedKeys().some((key: unknown) => Array.isArray(key) && key[0] === 'attendance-attachment'),
    ).toBe(false);
  });

  it('invalidates only the active conversation and its messages when it receives a message', () => {
    renderRealtime();

    act(() => {
      socket.emit('message.created', {
        conversationId: ACTIVE_ID,
        messageId: 'message-a',
        direction: 'INBOUND',
      });
    });

    expectInvalidated(attendanceKeys.conversationLists);
    expectInvalidated(attendanceKeys.conversation(ACTIVE_ID));
    expectInvalidated(attendanceKeys.messages(ACTIVE_ID));
    expectNotInvalidated(attendanceKeys.messages(OTHER_ID));
    expect(
      invalidatedKeys().some((key: unknown) => Array.isArray(key) && key[0] === 'attendance-attachment'),
    ).toBe(false);
  });

  it('refreshes active messages when conversation.updated carries a messageId', () => {
    renderRealtime();

    act(() => {
      socket.emit('conversation.updated', {
        conversationId: ACTIVE_ID,
        messageId: 'message-a',
      });
    });

    expectInvalidated(attendanceKeys.conversationLists);
    expectInvalidated(attendanceKeys.conversation(ACTIVE_ID));
    expectInvalidated(attendanceKeys.messages(ACTIVE_ID));
  });

  it('does not refresh messages for a conversation.updated without a messageId', () => {
    renderRealtime();

    act(() => {
      socket.emit('conversation.updated', { conversationId: ACTIVE_ID });
    });

    expectInvalidated(attendanceKeys.conversationLists);
    expectInvalidated(attendanceKeys.conversation(ACTIVE_ID));
    expectNotInvalidated(attendanceKeys.messages(ACTIVE_ID));
  });

  it('keeps attachment keys outside the attendance invalidation prefix', () => {
    const attachmentKey = attendanceKeys.attachment(
      ACTIVE_ID,
      'message-a',
      'attachment-a',
      'main',
    );

    expect(attachmentKey[0]).not.toBe(attendanceKeys.all[0]);
  });

  it('removes every listener on unmount', () => {
    const { unmount } = renderRealtime();

    expect(socket.listenerCount()).toBe(6);
    unmount();

    expect(socket.listenerCount()).toBe(0);
    expect(socket.off).toHaveBeenCalledTimes(6);
  });

  it('patches a reaction on the target message without invalidating queries', () => {
    const message = {
      id: 'message-a',
      conversationId: ACTIVE_ID,
      externalMessageId: 'ext-a',
      reactions: [],
    } as never;

    queryClient.setQueryData(attendanceKeys.messages(ACTIVE_ID), {
      data: [message],
      meta: { page: 1, perPage: 100, total: 1, totalPages: 1 },
    });
    queryClient.setQueryData(attendanceKeys.historyMessages(ACTIVE_ID), {
      pages: [{ data: [message], meta: { page: 2, perPage: 100, total: 2, totalPages: 2 } }],
      pageParams: [2],
    });
    renderRealtime();

    act(() => {
      socket.emit('message.reaction', {
        conversationId: ACTIVE_ID,
        messageId: 'message-a',
        reactions: [
          {
            id: 'reaction-a',
            reactorId: '5511999999999@s.whatsapp.net',
            reactorName: 'Ana',
            fromMe: false,
            emoji: '❤️',
            occurredAt: '2026-10-20T12:00:00.000Z',
          },
        ],
      });
    });

    expect(
      queryClient.getQueryData<{ data: Array<{ reactions: unknown[] }> }>(
        attendanceKeys.messages(ACTIVE_ID),
      )?.data[0].reactions,
    ).toEqual([expect.objectContaining({ emoji: '❤️' })]);
    expect(
      queryClient.getQueryData<{ pages: Array<{ data: Array<{ reactions: unknown[] }> }> }>(
        attendanceKeys.historyMessages(ACTIVE_ID),
      )?.pages[0].data[0].reactions,
    ).toEqual([expect.objectContaining({ emoji: '❤️' })]);
    expect(invalidateQueries).not.toHaveBeenCalled();

    act(() => {
      socket.emit('message.reaction', {
        conversationId: ACTIVE_ID,
        messageId: 'message-a',
        reactions: [],
      });
    });

    expect(
      queryClient.getQueryData<{ data: Array<{ reactions: unknown[] }> }>(
        attendanceKeys.messages(ACTIVE_ID),
      )?.data[0].reactions,
    ).toEqual([]);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('resynchronizes the inbox on connect without invalidating attachments', () => {
    renderRealtime();

    act(() => {
      socket.emit('connect');
    });

    expectInvalidated(attendanceKeys.conversationLists);
    expectInvalidated(attendanceKeys.unreadCount);
    expectInvalidated(attendanceKeys.conversation(ACTIVE_ID));
    expectInvalidated(attendanceKeys.messages(ACTIVE_ID));
    expect(
      invalidatedKeys().some((key: unknown) => Array.isArray(key) && key[0] === 'attendance-attachment'),
    ).toBe(false);
  });

  it('ignores events with missing or invalid conversation ids', () => {
    renderRealtime();

    act(() => {
      socket.emit('message.created');
      socket.emit('message.created', {});
      socket.emit('message.created', { conversationId: 123, messageId: 'message-a' });
      socket.emit('message.updated', { conversationId: null });
      socket.emit('conversation.updated', { conversationId: '' });
      socket.emit('conversation.deleted', { conversationId: false });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('updates the list when the active conversation is deleted and refreshes its panel', () => {
    renderRealtime();

    act(() => {
      socket.emit('conversation.deleted', { conversationId: ACTIVE_ID });
    });

    expectInvalidated(attendanceKeys.conversationLists);
    expectInvalidated(attendanceKeys.conversation(ACTIVE_ID));
    expectInvalidated(attendanceKeys.messages(ACTIVE_ID));
  });

  it('handles no active conversation without invalidating a conversation or messages', () => {
    renderRealtime(null);

    act(() => {
      socket.emit('message.created', {
        conversationId: OTHER_ID,
        messageId: 'message-b',
        direction: 'INBOUND',
      });
    });

    expectInvalidated(attendanceKeys.conversationLists);
    expect(
      invalidatedKeys().some((key: unknown) => Array.isArray(key) && key[1] === 'conversation'),
    ).toBe(false);
    expect(
      invalidatedKeys().some((key: unknown) => Array.isArray(key) && key[1] === 'messages'),
    ).toBe(false);
  });
});
