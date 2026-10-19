import { describe, expect, it } from 'vitest';
import { extractPreviewUrls, linkifyText } from './linkify-text';

describe('extractPreviewUrls', () => {
  it('extracts the first valid URLs and removes the trailing punctuation', () => {
    expect(
      extractPreviewUrls(
        'Veja https://exemplo.com/artigo. Também www.exemplo.com/outro, obrigado.',
      ),
    ).toEqual(['https://exemplo.com/artigo', 'https://www.exemplo.com/outro']);
  });

  it('deduplicates equivalent URLs and strips the fragment', () => {
    expect(
      extractPreviewUrls('https://exemplo.com/a#topo e https://exemplo.com/a#outra'),
    ).toEqual(['https://exemplo.com/a']);
  });

  it('ignores invalid or unsafe URLs', () => {
    expect(
      extractPreviewUrls(
        'https:// https://user:pass@exemplo.com javascript:alert(1) ftp://exemplo.com',
      ),
    ).toEqual([]);
  });

  it('keeps the original URL clickable in the message text', () => {
    const segments = linkifyText('Veja https://exemplo.com/artigo');

    expect(segments.find((segment) => segment.type === 'link')?.href).toBe(
      'https://exemplo.com/artigo',
    );
  });
});
