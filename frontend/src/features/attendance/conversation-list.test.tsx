// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, WhatsAppInstance } from '@/types/attendance';
import { ConversationList } from './conversation-list';

vi.mock('./sender-avatar', () => ({
  SenderAvatar: () => null,
}));

const conversation: Conversation = {
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
};

const instances: WhatsAppInstance[] = [];

function renderList(overrides: Partial<ComponentProps<typeof ConversationList>> = {}) {
  const props: ComponentProps<typeof ConversationList> = {
    conversations: [],
    activeId: null,
    onSelect: vi.fn(),
    isPending: false,
    isError: false,
    onRetry: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    status: 'ALL',
    onStatusChange: vi.fn(),
    instanceId: 'ALL',
    onInstanceChange: vi.fn(),
    instances,
    onTogglePin: vi.fn(),
    pinPendingId: null,
    archived: false,
    onArchivedChange: vi.fn(),
    onToggleArchive: vi.fn(),
    archivePendingId: null,
    onDelete: vi.fn(),
    deletePendingId: null,
    onEditTags: vi.fn(),
    ...overrides,
  };

  const result = render(
    <MemoryRouter>
      <ConversationList {...props} />
    </MemoryRouter>,
  );

  return { ...result, props };
}

afterEach(cleanup);

describe('ConversationList inbox tabs', () => {
  it('keeps the inbox and archived tabs visible next to the search on all viewports', () => {
    renderList();

    const tablist = screen.getByRole('tablist');
    expect(tablist.classList.contains('hidden')).toBe(false);
    expect(tablist.parentElement?.classList.contains('hidden')).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Buscar conversa' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Caixa de entrada' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Arquivadas' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('switches between inbox and archived conversations repeatedly', () => {
    const onArchivedChange = vi.fn();
    const { rerender, props } = renderList({ onArchivedChange });

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Arquivadas' }), { button: 0 });
    expect(onArchivedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <MemoryRouter>
        <ConversationList {...props} archived />
      </MemoryRouter>,
    );

    expect(screen.getByRole('tab', { name: 'Arquivadas' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Caixa de entrada' }), { button: 0 });
    expect(onArchivedChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps search and conversation selection working alongside the tabs', () => {
    const onSearchChange = vi.fn();
    const onSelect = vi.fn();
    renderList({
      conversations: [conversation],
      search: 'ana',
      onSearchChange,
      onSelect,
    });

    const searchInput = screen.getByRole('textbox', { name: 'Buscar conversa' });
    expect((searchInput as HTMLInputElement).value).toBe('ana');

    fireEvent.change(searchInput, { target: { value: 'cliente' } });
    expect(onSearchChange).toHaveBeenCalledWith('cliente');

    fireEvent.click(screen.getByText('Ana'));
    expect(onSelect).toHaveBeenCalledWith(conversation.id);
  });
});
