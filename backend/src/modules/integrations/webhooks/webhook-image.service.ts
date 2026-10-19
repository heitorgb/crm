import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Env } from '../../../config/env.validation.js';
import { MediaProcessingService } from '../../../infrastructure/media/media-processing.service.js';
import {
  WebhookImageFetchFailedError,
  WebhookImageInvalidError,
  WebhookImageTooLargeError,
  WebhookImageUrlInvalidError,
} from './webhooks.errors.js';

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;
const ABSOLUTE_MAX_IMAGE_BYTES = 15_000_000;

export interface RemoteWebhookImage {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

@Injectable()
export class WebhookImageService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly media: MediaProcessingService,
  ) {}

  async fetch(imageUrl: string): Promise<RemoteWebhookImage> {
    const maxBytes = Math.min(
      this.config.get('MEDIA_MAX_BYTES'),
      ABSOLUTE_MAX_IMAGE_BYTES,
    );
    let currentUrl = parsePublicHttpsUrl(imageUrl);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await assertPublicHost(currentUrl);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            accept: 'image/*',
            'user-agent': 'OrderUp-CRM-Webhook/1.0',
          },
        });
      } catch {
        throw new WebhookImageFetchFailedError();
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new WebhookImageFetchFailedError();
        }
        currentUrl = parsePublicHttpsUrl(new URL(location, currentUrl).toString());
        continue;
      }

      if (!response.ok) {
        throw new WebhookImageFetchFailedError();
      }

      const contentType = normalizeMimeType(response.headers.get('content-type'));
      if (!isSupportedContentType(contentType)) {
        throw new WebhookImageInvalidError();
      }

      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new WebhookImageTooLargeError();
      }

      let buffer: Buffer;
      try {
        buffer = await readLimitedBody(response, maxBytes);
      } catch (error) {
        if (error instanceof WebhookImageTooLargeError) {
          throw error;
        }
        throw new WebhookImageFetchFailedError();
      }

      if (buffer.length === 0 || !(await this.media.isImage(buffer))) {
        throw new WebhookImageInvalidError();
      }

      return {
        buffer,
        mimeType: contentType || 'application/octet-stream',
        fileName: fileNameFromUrl(currentUrl),
      };
    }

    throw new WebhookImageFetchFailedError();
  }
}

export function parsePublicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebhookImageUrlInvalidError();
  }

  if (url.protocol !== 'https:') {
    throw new WebhookImageUrlInvalidError('A imageUrl deve usar HTTPS.');
  }
  if (!url.hostname || url.username || url.password) {
    throw new WebhookImageUrlInvalidError();
  }

  return url;
}

export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.lan')
  ) {
    throw new WebhookImageUrlInvalidError();
  }

  if (isIP(hostname) !== 0) {
    if (isPrivateAddress(hostname)) {
      throw new WebhookImageUrlInvalidError();
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new WebhookImageFetchFailedError();
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new WebhookImageUrlInvalidError();
  }
}

export function isPrivateAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    const parts = normalized.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (family === 6) {
    if (normalized === '::' || normalized === '::1') {
      return true;
    }
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    if (/^fe[89ab]/.test(normalized)) {
      return true;
    }
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (mapped.includes('.')) {
        return isPrivateAddress(mapped);
      }
      const groups = mapped.split(':');
      if (groups.length === 2) {
        const high = Number.parseInt(groups[0], 16);
        const low = Number.parseInt(groups[1], 16);
        if (Number.isInteger(high) && Number.isInteger(low)) {
          return isPrivateAddress(
            `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
          );
        }
      }
    }
    return false;
  }

  return true;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizeMimeType(value: string | null): string {
  return value?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function isSupportedContentType(contentType: string): boolean {
  return (
    contentType.length === 0 ||
    contentType.startsWith('image/') ||
    contentType === 'application/octet-stream' ||
    contentType === 'binary/octet-stream'
  );
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WebhookImageTooLargeError();
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function fileNameFromUrl(url: URL): string {
  const raw = url.pathname.split('/').filter(Boolean).pop() ?? 'image';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  const sanitized = decoded.replace(/[^\w.-]/g, '_').trim();
  return sanitized.length > 0 ? sanitized : 'image';
}
