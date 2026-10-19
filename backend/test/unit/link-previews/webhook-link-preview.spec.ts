import { extractWhatsAppLinkPreview } from '../../../src/modules/webhooks/webhook.service.js';

describe('extractWhatsAppLinkPreview', () => {
  it('reads the preview metadata delivered by WhatsApp/Evolution', () => {
    const preview = extractWhatsAppLinkPreview({
      extendedTextMessage: {
        text: 'Veja https://exemplo.com/artigo',
        matchedText: 'https://exemplo.com/artigo',
        canonicalUrl: 'https://exemplo.com/artigo',
        title: 'Título do artigo',
        description: 'Resumo do artigo',
        thumbnailUrl: 'https://mmg.whatsapp.net/preview.jpg',
      },
    });

    expect(preview).toEqual({
      url: 'https://exemplo.com/artigo',
      title: 'Título do artigo',
      description: 'Resumo do artigo',
      imageUrl: 'https://mmg.whatsapp.net/preview.jpg',
      siteName: null,
      domain: 'exemplo.com',
    });
  });

  it('falls back to the embedded JPEG thumbnail', () => {
    const preview = extractWhatsAppLinkPreview({
      extendedTextMessage: {
        matchedText: 'https://exemplo.com',
        title: 'Título',
        jpegThumbnail: 'aGVsbG8=',
      },
    });

    expect(preview?.imageUrl).toBe('data:image/jpeg;base64,aGVsbG8=');
  });

  it('returns null for messages without a valid preview URL', () => {
    expect(extractWhatsAppLinkPreview({ conversation: 'sem link' })).toBeNull();
    expect(
      extractWhatsAppLinkPreview({
        extendedTextMessage: { canonicalUrl: 'javascript:alert(1)', title: 'x' },
      }),
    ).toBeNull();
  });

  it('returns null when the preview has no usable content', () => {
    expect(
      extractWhatsAppLinkPreview({
        extendedTextMessage: { matchedText: 'https://exemplo.com' },
      }),
    ).toBeNull();
  });
});
