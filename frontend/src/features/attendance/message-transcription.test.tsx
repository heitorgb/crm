// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ConversationMessage, MessageTranscription } from '@/types/attendance';

const retry = vi.hoisted(() => vi.fn());

vi.mock('./queries', () => ({
  useRetryTranscription: () => ({
    mutate: retry,
    isPending: false,
    isError: false,
  }),
}));

import { MessageTranscription as MessageTranscriptionBlock } from './message-transcription';

function message(transcription: MessageTranscription): ConversationMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    direction: 'INBOUND',
    type: 'AUDIO',
    content: null,
    externalMessageId: 'ext-1',
    status: 'RECEIVED',
    senderId: null,
    senderName: null,
    metadata: {},
    occurredAt: '2026-10-21T12:00:00.000Z',
    createdAt: '2026-10-21T12:00:00.000Z',
    attachments: [
      {
        id: 'attachment-1',
        fileName: 'audio.ogg',
        mimeType: 'audio/ogg',
        size: 10,
        width: null,
        height: null,
        hasThumbnail: false,
      },
    ],
    transcription,
  };
}

function transcription(overrides: Partial<MessageTranscription> = {}): MessageTranscription {
  return {
    status: 'COMPLETED',
    text: 'Quero saber o valor da proposta.',
    language: 'pt',
    provider: 'OPENAI',
    model: 'whisper-1',
    attempts: 1,
    retryable: false,
    canRetry: false,
    errorCode: null,
    errorMessage: null,
    transcribedAt: '2026-10-21T12:01:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  retry.mockClear();
});

afterEach(cleanup);

describe('MessageTranscription', () => {
  it('shows the transcript clearly identified as derived from audio', () => {
    render(<MessageTranscriptionBlock message={message(transcription())} />);

    expect(screen.getByText('Transcrição do áudio')).toBeTruthy();
    expect(screen.getByText('Quero saber o valor da proposta.')).toBeTruthy();
  });

  it('makes an old audio without a transcription row visible and recoverable', () => {
    const withoutState = { ...message(transcription()), transcription: null };
    render(<MessageTranscriptionBlock message={withoutState} />);

    expect(screen.getByText('Transcrição não realizada para este áudio.')).toBeTruthy();
    fireEvent.click(screen.getByText('Transcrever este áudio'));

    expect(retry).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      messageId: 'message-1',
    });
  });

  it('shows the waiting and processing states', () => {
    const { rerender } = render(
      <MessageTranscriptionBlock message={message(transcription({ status: 'PENDING', text: null }))} />,
    );
    expect(screen.getByText('Aguardando transcrição do áudio…')).toBeTruthy();

    rerender(
      <MessageTranscriptionBlock
        message={message(transcription({ status: 'PROCESSING', text: null }))}
      />,
    );
    expect(screen.getByText('Transcrevendo áudio…')).toBeTruthy();
  });

  it('offers a safe manual retry for a recoverable failure', () => {
    render(
      <MessageTranscriptionBlock
        message={message(
          transcription({
            status: 'FAILED',
            text: null,
            canRetry: true,
            retryable: true,
            errorMessage: 'O provedor de transcrição demorou demais para responder.',
          }),
        )}
      />,
    );

    expect(
      screen.getByText('O provedor de transcrição demorou demais para responder.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByText('Tentar transcrever novamente'));

    expect(retry).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      messageId: 'message-1',
    });
  });

  it('does not offer retry for a permanent failure', () => {
    render(
      <MessageTranscriptionBlock
        message={message(
          transcription({
            status: 'FAILED',
            text: null,
            canRetry: false,
            retryable: false,
            errorMessage: 'O áudio excede o tamanho máximo permitido para transcrição.',
          }),
        )}
      />,
    );

    expect(screen.queryByText('Tentar transcrever novamente')).toBeNull();
  });

  it('explains when transcription is unavailable by configuration', () => {
    render(
      <MessageTranscriptionBlock
        message={message(transcription({ status: 'NOT_APPLICABLE', text: null }))}
      />,
    );

    expect(screen.getByText('Transcrição de áudio não disponível por configuração.')).toBeTruthy();
    expect(screen.queryByText('Transcrever este áudio')).toBeNull();
  });

  it('offers retry for audio received before transcription was enabled', () => {
    render(
      <MessageTranscriptionBlock
        message={message(
          transcription({
            status: 'NOT_APPLICABLE',
            text: null,
            canRetry: true,
            retryable: false,
            errorCode: 'AI_TRANSCRIPTION_DISABLED',
          }),
        )}
      />,
    );

    fireEvent.click(screen.getByText('Transcrever este áudio'));

    expect(retry).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      messageId: 'message-1',
    });
  });

  it('does not render anything for outbound audio', () => {
    const outbound = { ...message(transcription()), direction: 'OUTBOUND' as const };
    render(<MessageTranscriptionBlock message={outbound} />);
    expect(screen.queryByText('Transcrição do áudio')).toBeNull();
  });
});
