// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    ...overrides,
  };
}

function renderBubble(
  status: ConversationMessage['status'],
  overrides: Partial<ConversationMessage> = {},
): void {
  render(
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
