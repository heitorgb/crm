// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/attendance';
import { ForwardMessageDialog } from './forward-message-dialog';

const mutateAsync = vi.fn();

vi.mock('./sender-avatar', () => ({
  SenderAvatar: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
}));

function buildConversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'OPEN',
    subject: null,
    isGroup: false,
    groupName: null,
    avatarUrl: null,
    isPinned: false,
    isArchived: false,
    unreadCount: 0,
    whatsappInstanceId: '22222222-2222-4222-8222-222222222222',
    instanceName: 'Comercial',
    externalContactId: '5511999999999@s.whatsapp.net',
    contactId: null,
    contactName: 'Ana',
    contactPhone: '5511999999999',
    customerId: null,
    customerName: null,
    lastMessageAt: null,
    lastMessage: null,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    ...overrides,
  };
}

const conversations = [
  buildConversation({}),
  buildConversation({
    id: '33333333-3333-4333-8333-333333333333',
    contactName: 'Bruno',
    contactPhone: '5511888888888',
  }),
];

vi.mock('./queries', () => ({
  useConversations: () => ({ data: { data: conversations }, isLoading: false }),
  useForwardConversationMessage: () => ({ mutateAsync, isPending: false }),
}));

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
});

describe('ForwardMessageDialog', () => {
  it('shows each conversation with avatar, name and phone', () => {
    render(<ForwardMessageDialog sourceConversationId="source" messageId="message" onClose={vi.fn()} />);

    expect(screen.getAllByTestId('avatar').map((node) => node.textContent)).toEqual(['Ana', 'Bruno']);
    expect(screen.getByText('5511999999999 · Comercial')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Encaminhar para/ })).toBeNull();
  });

  it('forwards to the selected conversations', async () => {
    mutateAsync.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ForwardMessageDialog sourceConversationId="source" messageId="message" onClose={onClose} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ana' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bruno' }));
    expect(screen.getByRole('checkbox', { name: 'Ana' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Ana, Bruno')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Encaminhar para 2 conversas' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'source',
      messageId: 'message',
      conversationIds: [conversations[0]?.id, conversations[1]?.id],
    });
  });
});
