import {
  assertPublicHost,
  isPrivateAddress,
  parsePublicHttpsUrl,
} from '../../../src/modules/integrations/webhooks/webhook-image.service.js';
import { WebhookImageUrlInvalidError } from '../../../src/modules/integrations/webhooks/webhooks.errors.js';

describe('WebhookImageService URL validation', () => {
  it('accepts only HTTPS URLs', () => {
    expect(parsePublicHttpsUrl('https://example.com/card.png').hostname).toBe('example.com');
    expect(() => parsePublicHttpsUrl('http://example.com/card.png')).toThrow(
      WebhookImageUrlInvalidError,
    );
    expect(() => parsePublicHttpsUrl('file:///etc/passwd')).toThrow(
      WebhookImageUrlInvalidError,
    );
    expect(() => parsePublicHttpsUrl('not-a-url')).toThrow(WebhookImageUrlInvalidError);
  });

  it('detects private, loopback, link-local and reserved IPv4 ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
  });

  it('detects private and loopback IPv6 addresses', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fd12:3456::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.0.1')).toBe(true);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('blocks localhost and private IP literals before any fetch', async () => {
    await expect(assertPublicHost(new URL('https://localhost/image.png'))).rejects.toBeInstanceOf(
      WebhookImageUrlInvalidError,
    );
    await expect(assertPublicHost(new URL('https://127.0.0.1/image.png'))).rejects.toBeInstanceOf(
      WebhookImageUrlInvalidError,
    );
    await expect(assertPublicHost(new URL('https://[::1]/image.png'))).rejects.toBeInstanceOf(
      WebhookImageUrlInvalidError,
    );
    await expect(assertPublicHost(new URL('https://8.8.8.8/image.png'))).resolves.toBeUndefined();
  });
});

import { WebhookImageService } from '../../../src/modules/integrations/webhooks/webhook-image.service.js';
import {
  WebhookImageFetchFailedError,
  WebhookImageInvalidError,
  WebhookImageTooLargeError,
} from '../../../src/modules/integrations/webhooks/webhooks.errors.js';

function createImageService(maxBytes = 1024) {
  const config = {
    get: (key: string) => (key === 'MEDIA_MAX_BYTES' ? maxBytes : undefined),
  };
  const media = {
    isImage: vi.fn().mockResolvedValue(true),
  };
  return {
    service: new WebhookImageService(config as never, media as never),
    media,
  };
}

describe('WebhookImageService fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads and validates an image from a public HTTPS URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from('image-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { service, media } = createImageService();

    const image = await service.fetch('https://8.8.8.8/card.png');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://8.8.8.8/card.png' }),
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(media.isImage).toHaveBeenCalled();
    expect(image).toMatchObject({
      mimeType: 'image/png',
      fileName: 'card.png',
    });
    expect(image.buffer.toString()).toBe('image-bytes');
  });

  it('rejects non-image content and undecodable images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not-an-image', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );
    const { service } = createImageService();
    await expect(service.fetch('https://8.8.8.8/card.txt')).rejects.toBeInstanceOf(
      WebhookImageInvalidError,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('fake', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    const harness = createImageService();
    harness.media.isImage.mockResolvedValue(false);
    await expect(harness.service.fetch('https://8.8.8.8/card.png')).rejects.toBeInstanceOf(
      WebhookImageInvalidError,
    );
  });

  it('rejects images above the configured limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('too-large', {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '2048' },
        }),
      ),
    );
    const { service } = createImageService(1024);
    await expect(service.fetch('https://8.8.8.8/card.png')).rejects.toBeInstanceOf(
      WebhookImageTooLargeError,
    );
  });

  it('rejects redirects to private hosts and download failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://127.0.0.1/card.png' },
        }),
      ),
    );
    const { service } = createImageService();
    await expect(service.fetch('https://8.8.8.8/card.png')).rejects.toBeInstanceOf(
      WebhookImageUrlInvalidError,
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(service.fetch('https://8.8.8.8/card.png')).rejects.toBeInstanceOf(
      WebhookImageFetchFailedError,
    );
  });
});
