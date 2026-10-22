// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, ConversationMessage } from '@/types/attendance';
import { ChatPanel } from './chat-panel';

Element.prototype.scrollIntoView = vi.fn();

const scrollMetrics = { height: 0, viewport: 0 };

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scrollMetrics.height,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => scrollMetrics.viewport,
  });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

beforeEach(() => {
  scrollMetrics.height = 0;
  scrollMetrics.viewport = 0;
});

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

let messageSequence = 0;

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  messageSequence += 1;
  return {
    id: `message-${messageSequence}`,
    conversationId: conversation.id,
    direction: 'INBOUND',
    type: 'TEXT',
    content: 'oi',
    externalMessageId: null,
    status: 'RECEIVED',
    senderId: null,
    senderName: null,
    metadata: null,
    occurredAt: '2026-10-20T12:00:00.000Z',
    createdAt: '2026-10-20T12:00:00.000Z',
    attachments: [],
    transcription: null,
    ...overrides,
  };
}

function renderChat(
  conversationValue: Conversation,
  messages: ConversationMessage[],
  options: {
    hasOlderMessages?: boolean;
    loadingOlderMessages?: boolean;
    onLoadOlderMessages?: () => void;
  } = {},
) {
  return render(
    <MemoryRouter>
      <ChatPanel
        conversation={conversationValue}
        messages={messages}
        messagesPending={false}
        messagesError={false}
        onRetryMessages={vi.fn()}
        hasOlderMessages={options.hasOlderMessages ?? false}
        loadingOlderMessages={options.loadingOlderMessages ?? false}
        onLoadOlderMessages={options.onLoadOlderMessages ?? vi.fn()}
        closePending={false}
        onClose={vi.fn()}
        reopenPending={false}
        onReopen={vi.fn()}
        refreshPending={false}
        onRefreshGroup={vi.fn()}
      />
    </MemoryRouter>,
  );
}

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

describe('ChatPanel message positioning', () => {
  it('opens an individual conversation at the bottom of the loaded history', () => {
    scrollMetrics.height = 2400;
    scrollMetrics.viewport = 600;

    renderChat(conversation, [message(), message()]);

    expect(screen.getByTestId('chat-messages').scrollTop).toBe(2400);
  });

  it('opens a group at the bottom of the loaded history', () => {
    scrollMetrics.height = 3600;
    scrollMetrics.viewport = 600;

    renderChat({ ...conversation, isGroup: true }, [message(), message(), message()]);

    expect(screen.getByTestId('chat-messages').scrollTop).toBe(3600);
  });

  it('recalculates the position when switching conversations', () => {
    scrollMetrics.height = 1800;
    scrollMetrics.viewport = 600;

    const { rerender } = renderChat(conversation, [message(), message()]);
    expect(screen.getByTestId('chat-messages').scrollTop).toBe(1800);

    scrollMetrics.height = 3200;
    rerender(
      <MemoryRouter>
        <ChatPanel
          key="other-conversation"
          conversation={{ ...conversation, id: 'other-conversation' }}
          messages={[message({ conversationId: 'other-conversation' }), message()]}
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

    expect(screen.getByTestId('chat-messages').scrollTop).toBe(3200);
  });

  it('keeps the bottom position when a new message arrives', () => {
    scrollMetrics.height = 2000;
    scrollMetrics.viewport = 600;

    const messages = [message(), message()];
    const { rerender } = renderChat(conversation, messages);
    const container = screen.getByTestId('chat-messages');
    expect(container.scrollTop).toBe(2000);

    scrollMetrics.height = 2200;
    rerender(
      <MemoryRouter>
        <ChatPanel
          conversation={conversation}
          messages={[...messages, message()]}
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

    expect(container.scrollTop).toBe(2200);
  });

  it('does not move the operator reading older messages when a new message arrives', () => {
    scrollMetrics.height = 2000;
    scrollMetrics.viewport = 600;

    const messages = [message(), message()];
    const { rerender } = renderChat(conversation, messages);
    const container = screen.getByTestId('chat-messages');

    container.scrollTop = 200;
    fireEvent.scroll(container);

    scrollMetrics.height = 2200;
    rerender(
      <MemoryRouter>
        <ChatPanel
          conversation={conversation}
          messages={[...messages, message()]}
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

    expect(container.scrollTop).toBe(200);
  });

  it('preserves the visual position when older messages are prepended', () => {
    scrollMetrics.height = 2000;
    scrollMetrics.viewport = 600;

    const messages = [message(), message()];
    const onLoadOlderMessages = vi.fn();
    const { rerender } = renderChat(conversation, messages, {
      hasOlderMessages: true,
      onLoadOlderMessages,
    });
    const container = screen.getByTestId('chat-messages');

    container.scrollTop = 0;
    fireEvent.scroll(container);
    expect(onLoadOlderMessages).toHaveBeenCalledTimes(1);

    scrollMetrics.height = 2600;
    rerender(
      <MemoryRouter>
        <ChatPanel
          conversation={conversation}
          messages={[message(), message(), ...messages]}
          messagesPending={false}
          messagesError={false}
          onRetryMessages={vi.fn()}
          hasOlderMessages
          loadingOlderMessages
          onLoadOlderMessages={onLoadOlderMessages}
          closePending={false}
          onClose={vi.fn()}
          reopenPending={false}
          onReopen={vi.fn()}
          refreshPending={false}
          onRefreshGroup={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(container.scrollTop).toBe(600);
  });
});
