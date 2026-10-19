import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAX_PREVIEW_URLS_PER_MESSAGE,
  normalizePreviewUrl,
  previewDomain,
  type LinkPreviewMetadata,
} from '../../common/link-preview/link-preview.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { parseLinkPreviewHtml } from './link-preview-parser.js';
import { fetchHtmlDocument, resolvePublicAddresses } from './safe-http.js';

interface CachedPreview {
  url: string;
  status: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  domain: string | null;
}

@Injectable()
export class LinkPreviewsService {
  private readonly logger = new Logger(LinkPreviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async resolveForCurrentTenant(rawUrls: string[]): Promise<LinkPreviewMetadata[]> {
    const { tenantId } = this.tenantContext.requireContext();
    return this.resolveMany(tenantId, rawUrls);
  }

  async resolveMany(tenantId: string, rawUrls: string[]): Promise<LinkPreviewMetadata[]> {
    const urls: string[] = [];
    const seen = new Set<string>();

    for (const raw of rawUrls) {
      const normalized = normalizePreviewUrl(raw);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= MAX_PREVIEW_URLS_PER_MESSAGE) {
        break;
      }
    }

    if (urls.length === 0) {
      return [];
    }

    const keys = urls.map((url) => ({ url, key: cacheKey(url) }));
    const cached = await this.prisma.linkPreview.findMany({
      where: {
        tenantId,
        urlKey: { in: keys.map((item) => item.key) },
        expiresAt: { gt: new Date() },
      },
      select: {
        url: true,
        status: true,
        title: true,
        description: true,
        imageUrl: true,
        siteName: true,
        domain: true,
      },
    });

    const cachedByKey = new Map(cached.map((item) => [cacheKey(item.url), item]));
    const resolved = new Map<string, LinkPreviewMetadata | null>();

    await Promise.all(
      keys.map(async ({ url, key }) => {
        const hit = cachedByKey.get(key);
        if (hit) {
          resolved.set(key, toMetadata(hit));
          return;
        }

        resolved.set(key, await this.fetchAndCache(tenantId, url, key));
      }),
    );

    return urls
      .map((url) => resolved.get(cacheKey(url)))
      .filter((preview): preview is LinkPreviewMetadata => preview !== null);
  }

  private async fetchAndCache(
    tenantId: string,
    url: string,
    key: string,
  ): Promise<LinkPreviewMetadata | null> {
    try {
      const document = await fetchHtmlDocument(url, {
        timeoutMs: this.config.get('LINK_PREVIEW_TIMEOUT_MS'),
        maxBytes: this.config.get('LINK_PREVIEW_MAX_BYTES'),
      });

      const parsed = parseLinkPreviewHtml(
        decodeHtml(document.body, document.contentType),
        document.finalUrl,
      );
      if (!parsed) {
        await this.cache(tenantId, url, key, 'EMPTY', null);
        return null;
      }

      const imageUrl = await this.validateImageUrl(parsed.imageUrl);
      const metadata: LinkPreviewMetadata = {
        url,
        title: parsed.title,
        description: parsed.description,
        imageUrl,
        siteName: parsed.siteName,
        domain: parsed.domain || previewDomain(url),
      };

      await this.cache(tenantId, url, key, 'OK', metadata);
      return metadata;
    } catch (error) {
      this.logger.debug(
        `Link preview unavailable for ${previewDomain(url) || 'unknown host'}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await this.cache(tenantId, url, key, 'FAILED', null);
      return null;
    }
  }

  private async validateImageUrl(imageUrl: string | null): Promise<string | null> {
    if (!imageUrl) {
      return null;
    }

    try {
      await resolvePublicAddresses(new URL(imageUrl));
      return imageUrl;
    } catch {
      return null;
    }
  }

  private async cache(
    tenantId: string,
    url: string,
    key: string,
    status: 'OK' | 'EMPTY' | 'FAILED',
    metadata: LinkPreviewMetadata | null,
  ): Promise<void> {
    const ttlSeconds =
      status === 'OK'
        ? this.config.get('LINK_PREVIEW_CACHE_TTL_SECONDS')
        : this.config.get('LINK_PREVIEW_FAILURE_TTL_SECONDS');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const data = {
      status,
      title: metadata?.title ?? null,
      description: metadata?.description ?? null,
      imageUrl: metadata?.imageUrl ?? null,
      siteName: metadata?.siteName ?? null,
      domain: metadata?.domain ?? previewDomain(url),
      fetchedAt: now,
      expiresAt,
    };

    await this.prisma.linkPreview.upsert({
      where: { tenantId_urlKey: { tenantId, urlKey: key } },
      create: { tenantId, url, urlKey: key, ...data },
      update: data,
    });
  }
}

function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

function toMetadata(row: CachedPreview): LinkPreviewMetadata | null {
  if (row.status !== 'OK') {
    return null;
  }

  return {
    url: row.url,
    title: row.title,
    description: row.description,
    imageUrl: row.imageUrl,
    siteName: row.siteName,
    domain: row.domain ?? previewDomain(row.url),
  };
}

function decodeHtml(body: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(body);
  } catch {
    return body.toString('utf8');
  }
}
