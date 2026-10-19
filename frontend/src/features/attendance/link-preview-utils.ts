import type { LinkPreview } from '@/types/attendance';

export function readLinkPreviewMetadata(
  metadata: Record<string, unknown> | null,
): LinkPreview | null {
  const raw = metadata?.linkPreview;
  if (!isRecord(raw)) {
    return null;
  }

  const url = readHttpUrl(raw.url);
  if (!url) {
    return null;
  }

  const title = readText(raw.title);
  const description = readText(raw.description);
  const siteName = readText(raw.siteName);
  const imageUrl = readImageUrl(raw.imageUrl);
  const domain = readText(raw.domain) ?? hostnameOf(url);

  if (!title && !description && !imageUrl && !domain) {
    return null;
  }

  return { url, title, description, imageUrl, siteName, domain };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function readImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
    return value;
  }
  return readHttpUrl(value);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
