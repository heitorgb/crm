// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ConversationMessage } from '@/types/attendance';
import { MessageBubble } from './message-bubble';

afterEach(cleanup);

function buildMessage(status: ConversationMessage['status']): ConversationMessage {
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
  };
}

function renderBubble(status: ConversationMessage['status']): void {
  render(
    <MessageBubble
      conversationId="conversation-1"
      message={buildMessage(status)}
      isGroup={false}
      whatsappInstanceId="instance-1"
    />,
  );
}

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
