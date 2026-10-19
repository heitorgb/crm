// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ConversationMessage, LinkPreview } from '@/types/attendance';
import { useLinkPreview } from './queries';
import { LinkPreviewCard, MessageLinkPreview } from './link-preview-card';
import { readLinkPreviewMetadata } from './link-preview-utils';

vi.mock('./queries', () => ({
  useLinkPreview: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PREVIEW: LinkPreview = {
  url: 'https://exemplo.com/artigo',
  title: 'Título da página',
  description: 'Descrição resumida.',
  imageUrl: 'https://exemplo.com/capa.png',
  siteName: 'Exemplo',
  domain: 'exemplo.com',
};

function buildMessage(metadata: Record<string, unknown>): ConversationMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    direction: 'INBOUND',
    type: 'TEXT',
    content: 'Veja https://exemplo.com/artigo',
    externalMessageId: 'ext-1',
    status: 'RECEIVED',
    senderId: 'contact-1',
    senderName: 'Contato',
    metadata,
    occurredAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
    createdAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
    attachments: [],
  };
}

describe('LinkPreviewCard', () => {
  it('renders image, title, description and domain from complete metadata', () => {
    const { container } = render(<LinkPreviewCard preview={PREVIEW} isOutbound={false} />);

    expect(screen.getByText('Título da página')).toBeTruthy();
    expect(screen.getByText('Descrição resumida.')).toBeTruthy();
    expect(screen.getByText('exemplo.com')).toBeTruthy();
    expect(screen.getByText('Exemplo')).toBeTruthy();

    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.href).toBe('https://exemplo.com/artigo');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://exemplo.com/capa.png');
    expect(image?.getAttribute('loading')).toBe('lazy');
  });

  it('renders without image or description', () => {
    const { container } = render(
      <LinkPreviewCard
        preview={{
          ...PREVIEW,
          imageUrl: null,
          description: null,
          siteName: null,
        }}
        isOutbound
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Título da página')).toBeTruthy();
    expect(screen.getByText('exemplo.com')).toBeTruthy();
  });

  it('does not render an empty card', () => {
    const { container } = render(
      <LinkPreviewCard
        preview={{
          url: 'https://exemplo.com',
          title: null,
          description: null,
          imageUrl: null,
          siteName: null,
          domain: '',
        }}
        isOutbound={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('readLinkPreviewMetadata', () => {
  it('reads and validates metadata stored by the webhook', () => {
    expect(readLinkPreviewMetadata({ linkPreview: PREVIEW })).toEqual(PREVIEW);
  });

  it('accepts embedded JPEG thumbnails from WhatsApp', () => {
    const preview = readLinkPreviewMetadata({
      linkPreview: {
        ...PREVIEW,
        imageUrl: 'data:image/jpeg;base64,aGVsbG8=',
      },
    });

    expect(preview?.imageUrl).toBe('data:image/jpeg;base64,aGVsbG8=');
  });

  it('rejects unsafe URLs and invalid payloads', () => {
    expect(readLinkPreviewMetadata(null)).toBeNull();
    expect(readLinkPreviewMetadata({ linkPreview: { url: 'javascript:alert(1)' } })).toBeNull();
    expect(
      readLinkPreviewMetadata({
        linkPreview: { ...PREVIEW, imageUrl: 'javascript:alert(1)' },
      })?.imageUrl,
    ).toBeNull();
  });
});

describe('MessageLinkPreview', () => {
  it('renders the stored preview without fetching it again', () => {
    render(
      <MessageLinkPreview message={buildMessage({ linkPreview: PREVIEW })} isOutbound={false} />,
    );

    expect(useLinkPreview).not.toHaveBeenCalled();
    expect(screen.getByText('Título da página')).toBeTruthy();
    expect(screen.getByText('exemplo.com')).toBeTruthy();
  });

  it('fetches the preview for an old message without stored metadata', () => {
    vi.mocked(useLinkPreview).mockReturnValue({
      data: PREVIEW,
      isLoading: false,
    } as never);

    render(<MessageLinkPreview message={buildMessage({})} isOutbound={false} />);

    expect(useLinkPreview).toHaveBeenCalledWith('https://exemplo.com/artigo');
    expect(screen.getByText('Título da página')).toBeTruthy();
  });

  it('shows a loading state while the preview is being fetched', () => {
    vi.mocked(useLinkPreview).mockReturnValue({
      data: null,
      isLoading: true,
    } as never);
    const { container } = render(
      <MessageLinkPreview message={buildMessage({})} isOutbound={false} />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.queryByText('Título da página')).toBeNull();
  });
});
