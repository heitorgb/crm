// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@/types/attendance';
import { MessageMedia } from './message-media';
import { useAttachmentBlob } from './queries';

vi.mock('./queries', () => ({ useAttachmentBlob: vi.fn() }));

const message: ConversationMessage = {
  id: 'message-1',
  conversationId: 'conversation-1',
  direction: 'OUTBOUND',
  type: 'IMAGE',
  content: null,
  externalMessageId: 'external-1',
  status: 'SENT',
  senderId: null,
  senderName: 'Atendente',
  metadata: null,
  occurredAt: '2026-10-20T12:00:00.000Z',
  createdAt: '2026-10-20T12:00:00.000Z',
  attachments: [
    {
      id: 'attachment-1',
      fileName: 'imagem.png',
      mimeType: 'image/png',
      size: 10,
      width: 100,
      height: 100,
      hasThumbnail: true,
    },
  ],
  transcription: null,
};

describe('MessageMedia object URL lifecycle', () => {
  const revokedUrls: string[] = [];
  let sequence = 0;
  let imageBlob: Blob;

  beforeEach(() => {
    sequence = 0;
    imageBlob = new Blob(['image'], { type: 'image/png' });
    revokedUrls.length = 0;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:preview-${++sequence}`),
      revokeObjectURL: vi.fn((url: string) => revokedUrls.push(url)),
    });
    vi.mocked(useAttachmentBlob).mockImplementation((params) => ({
      data: params.enabled === false ? undefined : imageBlob,
      isError: false,
    }) as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the rendered image URL valid after the Strict Mode remount cycle', async () => {
    render(
      <StrictMode>
        <MessageMedia conversationId="conversation-1" message={message} />
      </StrictMode>,
    );

    const image = await screen.findByAltText('imagem.png');
    await waitFor(() => expect(image.getAttribute('src')).toBeTruthy());

    expect(revokedUrls).not.toContain(image.getAttribute('src'));
  });
});
