import {
  MAX_PREVIEW_DESCRIPTION_LENGTH,
  MAX_PREVIEW_IMAGE_URL_LENGTH,
  MAX_PREVIEW_SITE_NAME_LENGTH,
  MAX_PREVIEW_TITLE_LENGTH,
  previewDomain,
  sanitizePreviewText,
  type LinkPreviewMetadata,
} from '../../common/link-preview/link-preview.js';

const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const TITLE_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;

export interface ParsedLinkPreview extends Omit<LinkPreviewMetadata, 'url' | 'domain'> {
  domain: string;
}

export function parseLinkPreviewHtml(html: string, finalUrl: string): ParsedLinkPreview | null {
  const metas = parseMetaTags(html);
  const get = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = metas.get(key);
      if (value) {
        return value;
      }
    }
    return null;
  };

  const title = sanitizePreviewText(
    get('og:title', 'twitter:title') ?? readTitleTag(html),
    MAX_PREVIEW_TITLE_LENGTH,
  );
  const description = sanitizePreviewText(
    get('og:description', 'twitter:description', 'description'),
    MAX_PREVIEW_DESCRIPTION_LENGTH,
  );
  const imageUrl = normalizeImageUrl(
    get('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'),
    finalUrl,
  );
  const siteName = sanitizePreviewText(
    get('og:site_name', 'application-name'),
    MAX_PREVIEW_SITE_NAME_LENGTH,
  );

  if (!title && !description && !imageUrl) {
    return null;
  }

  return {
    title,
    description,
    imageUrl,
    siteName,
    domain: previewDomain(finalUrl),
  };
}

function parseMetaTags(html: string): Map<string, string> {
  const metas = new Map<string, string>();
  META_TAG_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = META_TAG_PATTERN.exec(html)) !== null) {
    const attributes = parseAttributes(match[0]);
    const key = (
      attributes.get('property') ??
      attributes.get('name') ??
      attributes.get('itemprop') ??
      ''
    )
      .trim()
      .toLowerCase();
    const content = attributes.get('content');
    if (key && content && !metas.has(key)) {
      metas.set(key, content);
    }
  }

  return metas;
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(tag)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!attributes.has(name)) {
      attributes.set(name, value);
    }
  }

  return attributes;
}

function readTitleTag(html: string): string | null {
  const match = TITLE_PATTERN.exec(html);
  return match ? match[1] : null;
}

function normalizeImageUrl(value: string | null, baseUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const decoded = value
      .replace(/&amp;/gi, '&')
      .replace(/&#0*38;/g, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/g, "'")
      .trim();
    const url = new URL(decoded, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    const normalized = url.toString();
    return normalized.length > MAX_PREVIEW_IMAGE_URL_LENGTH ? null : normalized;
  } catch {
    return null;
  }
}
