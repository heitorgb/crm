// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ConversationMessage } from '@/types/attendance';
import { MessageBubble } from './message-bubble';

afterEach(cleanup);

function buildMessage(
  status: ConversationMessage['status'],
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    direction: 'OUTBOUND',
    type: 'TEXT',
    content: 'Olá, tudo bem?',
    externalMessageId: 'ext-1',
    status,
    senderId: 'user-1',
    senderName: 'Atendente',
    metadata: {},
    occurredAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
    createdAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
    attachments: [],
    transcription: null,
    ...overrides,
  };
}

function renderBubble(
  status: ConversationMessage['status'],
  overrides: Partial<ConversationMessage> = {},
): ReturnType<typeof render> {
  return render(
    <MessageBubble
      conversationId="conversation-1"
      message={buildMessage(status, overrides)}
      isGroup={false}
      whatsappInstanceId="instance-1"
    />,
  );
}

const LINK_PREVIEW = {
  url: 'https://exemplo.com/artigo',
  title: 'Título da página',
  description: 'Descrição resumida.',
  imageUrl: null,
  siteName: 'Exemplo',
  domain: 'exemplo.com',
};

describe('MessageBubble failure indicator', () => {
  it('marks a FAILED outbound message as not sent', () => {
    renderBubble('FAILED');

    expect(screen.getByText('Não enviada')).toBeTruthy();
    expect(screen.getByLabelText('Falha no envio')).toBeTruthy();
    expect(screen.getByText('Olá, tudo bem?')).toBeTruthy();
  });

  it('does not show a failure indicator for a SENT message', () => {
    renderBubble('SENT');

    expect(screen.queryByText('Não enviada')).toBeNull();
    expect(screen.queryByLabelText('Falha no envio')).toBeNull();
  });
});

const LONG_TEXT = Array.from({ length: 240 }, (_, index) => `mensagem${index}`).join(' ');

function expandFully(): void {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = screen.queryByRole('button', { name: 'Ler mais' });
    if (!button) {
      return;
    }
    fireEvent.click(button);
  }
  throw new Error('A mensagem não foi totalmente expandida');
}

describe('MessageBubble long content', () => {
  it('does not show the action for a short message', () => {
    renderBubble('SENT');

    expect(screen.queryByRole('button', { name: 'Ler mais' })).toBeNull();
  });

  it('collapses a long outbound message and reveals it progressively', () => {
    renderBubble('SENT', { content: LONG_TEXT });

    expect(screen.queryByText(LONG_TEXT)).toBeNull();
    expect(screen.getByText(/^mensagem0/)).toBeTruthy();

    expandFully();

    expect(screen.getByText(LONG_TEXT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ler mais' })).toBeNull();
  });

  it('applies the same behavior to a long inbound message', () => {
    renderBubble('RECEIVED', {
      direction: 'INBOUND',
      content: LONG_TEXT,
      senderName: 'Cliente',
    });

    expect(screen.queryByText(LONG_TEXT)).toBeNull();
    expect(screen.getByRole('button', { name: 'Ler mais' })).toBeTruthy();

    expandFully();

    expect(screen.getByText(LONG_TEXT)).toBeTruthy();
  });
});

describe('MessageBubble link preview', () => {
  it('renders the stored preview on an outbound message', () => {
    renderBubble('SENT', {
      content: 'Veja https://exemplo.com/artigo',
      metadata: { linkPreview: LINK_PREVIEW },
    });

    expect(screen.getByText('Título da página')).toBeTruthy();
    expect(screen.getByText('Descrição resumida.')).toBeTruthy();
    expect(screen.getByText('exemplo.com')).toBeTruthy();
    expect(screen.getByText('https://exemplo.com/artigo')).toBeTruthy();
  });

  it('renders the stored preview on an inbound message', () => {
    renderBubble('RECEIVED', {
      direction: 'INBOUND',
      content: 'Veja https://exemplo.com/artigo',
      metadata: { linkPreview: LINK_PREVIEW },
    });

    expect(screen.getByText('Título da página')).toBeTruthy();
    expect(screen.getByText('exemplo.com')).toBeTruthy();
  });

  it('keeps the original URL visible and linked', () => {
    renderBubble('SENT', {
      content: 'Veja https://exemplo.com/artigo',
      metadata: { linkPreview: LINK_PREVIEW },
    });

    expect(screen.getByText('https://exemplo.com/artigo').closest('a')?.href).toBe(
      'https://exemplo.com/artigo',
    );
  });
});

describe('MessageBubble reactions', () => {
  it('renders reactions on the original message bubble', () => {
    renderBubble('RECEIVED', {
      direction: 'INBOUND',
      content: 'Mensagem original',
      reactions: [
        {
          id: 'reaction-1',
          reactorId: '5511999999999@s.whatsapp.net',
          reactorName: 'Ana',
          fromMe: false,
          emoji: '❤️',
          occurredAt: '2026-01-01T10:01:00.000Z',
        },
        {
          id: 'reaction-2',
          reactorId: 'self',
          reactorName: null,
          fromMe: true,
          emoji: '❤️',
          occurredAt: '2026-01-01T10:02:00.000Z',
        },
      ],
    });

    expect(screen.getByText('Mensagem original')).toBeTruthy();
    expect(screen.getByLabelText('Reação de Ana, Você: ❤️')).toBeTruthy();
  });

  it('does not render a legacy reaction row as a standalone message bubble', () => {
    const { container } = renderBubble('RECEIVED', {
      type: 'REACTION',
      direction: 'INBOUND',
      content: '👍',
    });

    expect(container.querySelector('[data-message-id="message-1"]')).toBeNull();
  });
});
