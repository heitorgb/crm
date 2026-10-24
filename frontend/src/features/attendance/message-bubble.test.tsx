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

describe('MessageBubble quoted replies', () => {
  const audioQuote = {
    messageId: 'original-1',
    externalId: 'wamid.audio',
    authorName: 'Kkroto',
    authorJid: 'kkroto@lid',
    fromMe: false,
    content: null,
    type: 'AUDIO' as const,
    audioDurationSeconds: 28,
  };

  it('renders the author, audio icon and duration of a quoted audio', () => {
    renderBubble('RECEIVED', {
      direction: 'INBOUND',
      content: 'Matar resolve logo',
      senderName: 'Caio',
      metadata: { quoted: audioQuote },
    });

    expect(screen.getByText('Kkroto')).toBeTruthy();
    expect(screen.getByText('0:28')).toBeTruthy();
    expect(screen.getByText('Matar resolve logo')).toBeTruthy();
  });

  it('completes the quote when the original audio is loaded later', () => {
    const original: ConversationMessage = buildMessage('RECEIVED', {
      id: 'original-1',
      direction: 'INBOUND',
      type: 'AUDIO',
      content: null,
      senderId: 'kkroto@lid',
      senderName: 'Kkroto',
      metadata: { audioDurationSeconds: 28 },
    });

    render(
      <MessageBubble
        conversationId="conversation-1"
        message={buildMessage('RECEIVED', {
          direction: 'INBOUND',
          content: 'Matar resolve logo',
          metadata: {
            quoted: {
              ...audioQuote,
              messageId: null,
              authorName: null,
              authorJid: null,
              type: 'UNKNOWN',
            },
          },
        })}
        quoteTarget={original}
        isGroup={false}
        whatsappInstanceId="instance-1"
      />,
    );

    expect(screen.getByText('Kkroto')).toBeTruthy();
    expect(screen.getByText('0:28')).toBeTruthy();
  });

  it('keeps text quotes rendered as before', () => {
    renderBubble('RECEIVED', {
      direction: 'INBOUND',
      content: 'Exatamente',
      metadata: {
        quoted: {
          ...audioQuote,
          messageId: 'original-2',
          authorName: 'Ana',
          authorJid: 'ana@s.whatsapp.net',
          type: 'TEXT',
          content: 'Seria o que, umas 8 instâncias?',
          audioDurationSeconds: null,
        },
      },
    });

    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Seria o que, umas 8 instâncias?')).toBeTruthy();
    expect(screen.getByText('Exatamente')).toBeTruthy();
  });
});
