export interface LinkPreviewMetadata {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  domain: string;
}

export const MAX_PREVIEW_URL_LENGTH = 1024;
export const MAX_PREVIEW_TITLE_LENGTH = 300;
export const MAX_PREVIEW_DESCRIPTION_LENGTH = 600;
export const MAX_PREVIEW_SITE_NAME_LENGTH = 120;
export const MAX_PREVIEW_IMAGE_URL_LENGTH = 2048;
export const MAX_PREVIEW_URLS_PER_MESSAGE = 3;

const URL_IN_TEXT_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

export function normalizePreviewUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PREVIEW_URL_LENGTH) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : /^www\./i.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function extractPreviewUrlsFromText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  URL_IN_TEXT_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_IN_TEXT_PATTERN.exec(text)) !== null) {
    const raw = match[0];
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const normalized = normalizePreviewUrl(trailing ? raw.slice(0, -trailing.length) : raw);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= MAX_PREVIEW_URLS_PER_MESSAGE) {
      break;
    }
  }

  return urls;
}

export function hasHttpUrl(text: string | null | undefined): boolean {
  return extractPreviewUrlsFromText(text).length > 0;
}

export function sanitizePreviewText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const withoutTags = value.replace(/<[^>]*>/g, ' ');
  const withoutControl = Array.from(withoutTags, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
  const decoded = decodeBasicEntities(withoutControl).replace(/\s+/g, ' ').trim();

  if (decoded.length === 0) {
    return null;
  }

  return decoded.length > maxLength ? `${decoded.slice(0, maxLength - 1).trimEnd()}…` : decoded;
}

export function previewDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => safeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return ' ';
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return ' ';
  }
}
