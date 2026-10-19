const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

export interface TextSegment {
  type: 'text' | 'link';
  value: string;
  href?: string;
}

export function linkifyText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const raw = match[0];
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const url = trailing ? raw.slice(0, -trailing.length) : raw;

    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    if (url.length > 0) {
      segments.push({
        type: 'link',
        value: url,
        href: url.startsWith('www.') ? `https://${url}` : url,
      });
      if (trailing) {
        segments.push({ type: 'text', value: trailing });
      }
    } else {
      segments.push({ type: 'text', value: raw });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

export function extractPreviewUrls(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const segment of linkifyText(text)) {
    if (segment.type !== 'link' || !segment.href) {
      continue;
    }

    let normalized: string;
    try {
      const url = new URL(segment.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        continue;
      }
      if (url.username || url.password || !url.hostname) {
        continue;
      }
      url.hash = '';
      normalized = url.toString();
    } catch {
      continue;
    }

    if (normalized.length > 1024 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= 3) {
      break;
    }
  }

  return urls;
}
