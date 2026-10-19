import {
  extractPreviewUrlsFromText,
  normalizePreviewUrl,
  sanitizePreviewText,
} from '../../../src/common/link-preview/link-preview.js';

describe('link preview URL normalization', () => {
  it('normalizes http, https and www URLs', () => {
    expect(normalizePreviewUrl('https://exemplo.com/a#trecho')).toBe('https://exemplo.com/a');
    expect(normalizePreviewUrl('www.exemplo.com')).toBe('https://www.exemplo.com/');
    expect(normalizePreviewUrl('  http://exemplo.com  ')).toBe('http://exemplo.com/');
  });

  it('rejects unsupported protocols, credentials and invalid input', () => {
    expect(normalizePreviewUrl('ftp://exemplo.com')).toBeNull();
    expect(normalizePreviewUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePreviewUrl('https://user:pass@exemplo.com')).toBeNull();
    expect(normalizePreviewUrl('exemplo.com')).toBeNull();
    expect(normalizePreviewUrl('')).toBeNull();
  });

  it('extracts multiple unique URLs and trims trailing punctuation', () => {
    const urls = extractPreviewUrlsFromText(
      'Veja https://a.com/x, depois www.b.com/y. Repetido: https://a.com/x?',
    );

    expect(urls).toEqual(['https://a.com/x', 'https://www.b.com/y']);
  });

  it('ignores invalid URLs and caps the number of URLs', () => {
    const urls = extractPreviewUrlsFromText(
      'ftp://a.com https://a.com https://b.com https://c.com https://d.com',
    );

    expect(urls).toEqual(['https://a.com/', 'https://b.com/', 'https://c.com/']);
  });
});

describe('sanitizePreviewText', () => {
  it('removes tags, control characters and excess whitespace', () => {
    expect(sanitizePreviewText(' <b>Olá</b> \u0001 mundo ', 50)).toBe('Olá mundo');
  });

  it('truncates long values with an ellipsis', () => {
    expect(sanitizePreviewText('a'.repeat(20), 10)).toBe('aaaaaaaaa…');
  });

  it('returns null for empty content', () => {
    expect(sanitizePreviewText('   ', 10)).toBeNull();
    expect(sanitizePreviewText(null, 10)).toBeNull();
  });
});
