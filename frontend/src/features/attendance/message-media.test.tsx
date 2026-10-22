// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('reuses the object URL when the message re-renders with the same attachment blob', async () => {
    const { rerender } = render(
      <MessageMedia conversationId="conversation-1" message={message} />,
    );

    const image = await screen.findByAltText('imagem.png');
    const source = image.getAttribute('src');
    const createObjectUrl = vi.mocked(URL.createObjectURL);
    const createdUrls = createObjectUrl.mock.calls.length;

    rerender(
      <MessageMedia
        conversationId="conversation-1"
        message={{ ...message, status: 'DELIVERED' }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByAltText('imagem.png').getAttribute('src')).toBe(source),
    );
    expect(createObjectUrl).toHaveBeenCalledTimes(createdUrls);
    expect(revokedUrls).not.toContain(source);
  });
});

function videoMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    ...message,
    id: 'message-video',
    type: 'VIDEO',
    attachments: [
      {
        id: 'attachment-video',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        size: 1024,
        width: null,
        height: null,
        hasThumbnail: false,
      },
    ],
    ...overrides,
  };
}

describe('MessageMedia video rendering', () => {
  const videoBlob = new Blob(['video'], { type: 'video/mp4' });

  beforeEach(() => {
    vi.mocked(useAttachmentBlob).mockClear();
    vi.mocked(useAttachmentBlob).mockImplementation((params) => ({
      data: params.enabled === false ? undefined : videoBlob,
      isPending: false,
      isError: false,
    }) as never);
    let sequence = 0;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:video-${++sequence}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a preview and only loads the main file when playback is requested', async () => {
    const { container } = render(
      <MessageMedia conversationId="conversation-1" message={videoMessage()} />,
    );

    expect(screen.getByRole('button', { name: 'Reproduzir vídeo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar vídeo' })).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
    expect(
      vi.mocked(useAttachmentBlob).mock.calls.every(([params]) => params.enabled === false),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Reproduzir vídeo' }));

    const video = await waitFor(() => {
      const element = container.querySelector('video');
      expect(element).toBeTruthy();
      return element as HTMLVideoElement;
    });

    expect(video.controls).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.getAttribute('preload')).toBe('metadata');
  });

  it('uses the thumbnail as the preview when the attachment has one', async () => {
    const withThumbnail = videoMessage({
      attachments: [
        {
          ...videoMessage().attachments[0],
          hasThumbnail: true,
        },
      ],
    });
    const { container } = render(
      <MessageMedia conversationId="conversation-1" message={withThumbnail} />,
    );

    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reproduzir vídeo' })).toBeTruthy();
  });

  it('renders a document with a video MIME type as a video', () => {
    render(
      <MessageMedia
        conversationId="conversation-1"
        message={videoMessage({ type: 'DOCUMENT' })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Reproduzir vídeo' })).toBeTruthy();
  });

  it('falls back to a download state when the video cannot be played', async () => {
    const { container } = render(
      <MessageMedia conversationId="conversation-1" message={videoMessage()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reproduzir vídeo' }));
    const video = await waitFor(() => {
      const element = container.querySelector('video');
      expect(element).toBeTruthy();
      return element as HTMLVideoElement;
    });

    fireEvent.error(video);

    expect(screen.getByRole('alert').textContent).toBe(
      'Não foi possível reproduzir este vídeo.',
    );
    expect(screen.getByRole('button', { name: 'Baixar vídeo' })).toBeTruthy();
  });
});
