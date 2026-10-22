// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/attendance';
import { attendanceService } from './services/attendance-service';
import { attendanceKeys, useMarkConversationRead } from './queries';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';

const unreadConversation: Conversation = {
  id: CONVERSATION_ID,
  status: 'OPEN',
  subject: null,
  isGroup: false,
  groupName: null,
  avatarUrl: null,
  isPinned: false,
  isArchived: false,
  unreadCount: 3,
  whatsappInstanceId: '66666666-6666-4666-8666-666666666666',
  instanceName: 'Comercial',
  externalContactId: '5511999999999@s.whatsapp.net',
  contactId: null,
  contactName: 'Ana',
  contactPhone: '5511999999999',
  customerId: null,
  customerName: null,
  lastMessageAt: '2026-10-20T12:00:00.000Z',
  lastMessage: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
};

const readConversation: Conversation = {
  ...unreadConversation,
  unreadCount: 0,
};

let queryClient: QueryClient;
let invalidateQueries: ReturnType<typeof vi.spyOn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateQueries = vi
    .spyOn(queryClient, 'invalidateQueries')
    .mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMarkConversationRead', () => {
  it('updates the conversation with the API result and only invalidates list and unread count', async () => {
    queryClient.setQueryData(attendanceKeys.conversation(CONVERSATION_ID), unreadConversation);
    queryClient.setQueryData(attendanceKeys.messages(CONVERSATION_ID), {
      data: [],
      meta: { page: 1, perPage: 100, total: 0, totalPages: 0 },
    });
    const markRead = vi
      .spyOn(attendanceService, 'markRead')
      .mockResolvedValue(readConversation);

    const { result } = renderHook(() => useMarkConversationRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(CONVERSATION_ID);
    });

    expect(markRead).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(queryClient.getQueryData(attendanceKeys.conversation(CONVERSATION_ID))).toEqual(
      readConversation,
    );

    const invalidatedKeys = invalidateQueries.mock.calls.map((call: unknown) => {
      const filters = (call as unknown[])[0] as { queryKey?: unknown } | undefined;
      return filters?.queryKey;
    });
    expect(invalidatedKeys).toContainEqual(attendanceKeys.conversationLists);
    expect(invalidatedKeys).toContainEqual(attendanceKeys.unreadCount);
    expect(invalidatedKeys).not.toContainEqual(attendanceKeys.messages(CONVERSATION_ID));
    expect(invalidatedKeys).not.toContainEqual(attendanceKeys.all);
    expect(
      invalidatedKeys.some(
        (key: unknown) => Array.isArray(key) && key[0] === 'attendance-attachment',
      ),
    ).toBe(false);
  });
});
