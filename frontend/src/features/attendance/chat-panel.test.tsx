// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/attendance';
import { ChatPanel } from './chat-panel';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('./message-composer', () => ({
  MessageComposer: () => <div data-testid="composer-mock" />,
}));

vi.mock('./message-editor', () => ({
  MessageEditor: () => null,
}));

vi.mock('./message-bubble', () => ({
  MessageBubble: () => null,
}));

vi.mock('./sender-avatar', () => ({
  SenderAvatar: () => null,
}));

const conversation: Conversation = {
  id: '55555555-5555-4555-8555-555555555555',
  status: 'OPEN',
  subject: null,
  isGroup: false,
  groupName: null,
  avatarUrl: null,
  isPinned: false,
  isArchived: false,
  unreadCount: 0,
  whatsappInstanceId: '66666666-6666-4666-8666-666666666666',
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

afterEach(cleanup);

describe('ChatPanel layout', () => {
  it('keeps the composer outside the scrollable message history', () => {
    render(
      <MemoryRouter>
        <ChatPanel
          conversation={conversation}
          messages={[]}
          messagesPending={false}
          messagesError={false}
          onRetryMessages={vi.fn()}
          hasOlderMessages={false}
          loadingOlderMessages={false}
          onLoadOlderMessages={vi.fn()}
          closePending={false}
          onClose={vi.fn()}
          reopenPending={false}
          onReopen={vi.fn()}
          refreshPending={false}
          onRefreshGroup={vi.fn()}
        />
      </MemoryRouter>,
    );

    const panel = screen.getByTestId('chat-panel');
    const messages = screen.getByTestId('chat-messages');
    const composer = screen.getByTestId('composer-mock');

    expect(panel.className.split(/\s+/)).toContain('min-h-0');
    expect(panel.className.split(/\s+/)).toContain('flex-1');
    expect(panel.className.split(/\s+/)).toContain('overflow-hidden');

    expect(messages.className.split(/\s+/)).toContain('min-h-0');
    expect(messages.className.split(/\s+/)).toContain('flex-1');
    expect(messages.className.split(/\s+/)).toContain('overflow-y-auto');
    expect(messages.contains(composer)).toBe(false);
    expect(composer.parentElement).toBe(panel);
  });
});
