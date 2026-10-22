import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@/types/attendance';
import {
  isMediaMessage,
  isMediaPending,
  isVideoMessage,
  isViewOnceMessage,
} from './media-message-utils';

let sequence = 0;

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  sequence += 1;
  return {
    id: `msg-${sequence}`,
    conversationId: 'conv-1',
    direction: 'INBOUND',
    type: 'IMAGE',
    content: null,
    externalMessageId: null,
    status: 'RECEIVED',
    senderId: 'sender@s.whatsapp.net',
    senderName: 'Ana Vilma',
    metadata: null,
    occurredAt: '2026-10-14T12:00:00.000Z',
    createdAt: '2026-10-14T12:00:00.000Z',
    attachments: [],
    transcription: null,
    ...overrides,
  };
}

describe('isViewOnceMessage', () => {
  it('detects a view-once message with valid metadata', () => {
    const viewOnce = message({ metadata: { viewOnce: true }, type: 'IMAGE' });

    expect(isViewOnceMessage(viewOnce)).toBe(true);
  });

  it('detects a view-once message even without a media attachment', () => {
    const viewOnce = message({ metadata: { viewOnce: true }, type: 'VIDEO', attachments: [] });

    expect(isViewOnceMessage(viewOnce)).toBe(true);
  });

  it('detects a view-once message without a sender id', () => {
    const viewOnce = message({
      metadata: { viewOnce: true },
      senderId: null,
      senderName: null,
    });

    expect(isViewOnceMessage(viewOnce)).toBe(true);
  });

  it('does not flag a regular media message', () => {
    expect(isViewOnceMessage(message({ type: 'IMAGE' }))).toBe(false);
  });

  it('does not flag a truly unknown message', () => {
    expect(isViewOnceMessage(message({ type: 'UNKNOWN', metadata: null }))).toBe(false);
  });
});

describe('isVideoMessage', () => {
  it('detects a video by its message type', () => {
    expect(isVideoMessage(message({ type: 'VIDEO' }))).toBe(true);
  });

  it('detects a document with a video MIME type', () => {
    const document = message({
      type: 'DOCUMENT',
      attachments: [
        {
          id: 'attachment-1',
          fileName: 'video.mp4',
          mimeType: 'video/mp4',
          size: 10,
          width: null,
          height: null,
          hasThumbnail: false,
        },
      ],
    });

    expect(isVideoMessage(document)).toBe(true);
  });

  it('does not treat other attachments as video', () => {
    const document = message({
      type: 'DOCUMENT',
      attachments: [
        {
          id: 'attachment-1',
          fileName: 'arquivo.pdf',
          mimeType: 'application/pdf',
          size: 10,
          width: null,
          height: null,
          hasThumbnail: false,
        },
      ],
    });

    expect(isVideoMessage(document)).toBe(false);
    expect(isVideoMessage(message({ type: 'STICKER' }))).toBe(false);
  });
});

describe('isMediaPending', () => {
  it('never treats a view-once message as pending media', () => {
    const viewOnce = message({
      metadata: { viewOnce: true },
      type: 'IMAGE',
      attachments: [],
    });

    expect(isMediaMessage(viewOnce)).toBe(true);
    expect(isMediaPending(viewOnce)).toBe(false);
  });

  it('treats a regular media message without attachment as pending', () => {
    const image = message({ type: 'IMAGE', attachments: [] });

    expect(isMediaPending(image)).toBe(true);
  });

  it('ignores non-media messages', () => {
    expect(isMediaPending(message({ type: 'TEXT' }))).toBe(false);
  });
});
