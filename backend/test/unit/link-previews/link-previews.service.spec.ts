import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { LinkPreviewsService } from '../../../src/modules/link-previews/link-previews.service.js';
import type { PlatformSettingsService } from '../../../src/modules/platform-settings/platform-settings.service.js';

const mocks = vi.hoisted(() => ({
  fetchHtmlDocument: vi.fn(),
  resolvePublicAddresses: vi.fn(),
}));

vi.mock('../../../src/modules/link-previews/safe-http.js', () => ({
  fetchHtmlDocument: mocks.fetchHtmlDocument,
  resolvePublicAddresses: mocks.resolvePublicAddresses,
}));

interface PrismaMock {
  linkPreview: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}

const CONFIG: Record<string, number> = {
  LINK_PREVIEW_TIMEOUT_MS: 5000,
  LINK_PREVIEW_MAX_BYTES: 524288,
  LINK_PREVIEW_CACHE_TTL_SECONDS: 604800,
  LINK_PREVIEW_FAILURE_TTL_SECONDS: 21600,
};

interface PlatformSettingsMock {
  isLinkPreviewsEnabled: ReturnType<typeof vi.fn>;
}

function createService(): {
  service: LinkPreviewsService;
  prisma: PrismaMock;
  platformSettings: PlatformSettingsMock;
} {
  const prisma: PrismaMock = {
    linkPreview: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const tenantContext = {
    requireContext: () => ({ tenantId: 'tenant-1' }),
  } as unknown as TenantContextService;
  const config = {
    get: (key: string) => CONFIG[key],
  } as unknown as ConfigService<Env, true>;
  const platformSettings: PlatformSettingsMock = {
    isLinkPreviewsEnabled: vi.fn().mockResolvedValue(true),
  };

  return {
    service: new LinkPreviewsService(
      prisma as unknown as PrismaService,
      tenantContext,
      config,
      platformSettings as unknown as PlatformSettingsService,
    ),
    prisma,
    platformSettings,
  };
}

function htmlWithMetadata(): string {
  return `
    <meta property="og:title" content="Título" />
    <meta property="og:description" content="Descrição" />
    <meta property="og:image" content="https://cdn.exemplo.com/capa.png" />
    <meta property="og:site_name" content="Exemplo" />
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePublicAddresses.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
});

describe('LinkPreviewsService', () => {
  it('does not fetch or cache anything when previews are disabled globally', async () => {
    const { service, prisma, platformSettings } = createService();
    platformSettings.isLinkPreviewsEnabled.mockResolvedValue(false);

    const previews = await service.resolveMany('tenant-1', ['https://exemplo.com/artigo']);

    expect(previews).toEqual([]);
    expect(prisma.linkPreview.findMany).not.toHaveBeenCalled();
    expect(mocks.fetchHtmlDocument).not.toHaveBeenCalled();
  });

  it('fetches and caches complete metadata', async () => {
    const { service, prisma } = createService();
    mocks.fetchHtmlDocument.mockResolvedValue({
      finalUrl: 'https://exemplo.com/artigo',
      body: Buffer.from(htmlWithMetadata()),
      contentType: 'text/html; charset=utf-8',
    });

    const previews = await service.resolveMany('tenant-1', ['https://exemplo.com/artigo']);

    expect(previews).toEqual([
      {
        url: 'https://exemplo.com/artigo',
        title: 'Título',
        description: 'Descrição',
        imageUrl: 'https://cdn.exemplo.com/capa.png',
        siteName: 'Exemplo',
        domain: 'exemplo.com',
      },
    ]);
    expect(prisma.linkPreview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'OK', title: 'Título' }),
        update: expect.objectContaining({ status: 'OK' }),
      }),
    );
  });

  it('returns a fresh cache entry without fetching the page again', async () => {
    const { service, prisma } = createService();
    prisma.linkPreview.findMany.mockResolvedValue([
      {
        url: 'https://exemplo.com/',
        status: 'OK',
        title: 'Cache',
        description: null,
        imageUrl: null,
        siteName: null,
        domain: 'exemplo.com',
      },
    ]);

    const previews = await service.resolveMany('tenant-1', ['https://exemplo.com']);

    expect(previews).toEqual([
      {
        url: 'https://exemplo.com/',
        title: 'Cache',
        description: null,
        imageUrl: null,
        siteName: null,
        domain: 'exemplo.com',
      },
    ]);
    expect(mocks.fetchHtmlDocument).not.toHaveBeenCalled();
  });

  it('caches failures and returns no preview when the fetch fails', async () => {
    const { service, prisma } = createService();
    mocks.fetchHtmlDocument.mockRejectedValue(new Error('timeout'));

    const previews = await service.resolveMany('tenant-1', ['https://exemplo.com']);

    expect(previews).toEqual([]);
    expect(prisma.linkPreview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('caches pages without usable metadata as empty', async () => {
    const { service, prisma } = createService();
    mocks.fetchHtmlDocument.mockResolvedValue({
      finalUrl: 'https://exemplo.com',
      body: Buffer.from('<html><body>Sem metadados</body></html>'),
      contentType: 'text/html',
    });

    const previews = await service.resolveMany('tenant-1', ['https://exemplo.com']);

    expect(previews).toEqual([]);
    expect(prisma.linkPreview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'EMPTY' }),
      }),
    );
  });

  it('drops unsafe image URLs but keeps the remaining metadata', async () => {
    const { service } = createService();
    mocks.fetchHtmlDocument.mockResolvedValue({
      finalUrl: 'https://exemplo.com',
      body: Buffer.from(htmlWithMetadata()),
      contentType: 'text/html',
    });
    mocks.resolvePublicAddresses.mockRejectedValue(new Error('private address'));

    const previews = await service.resolveMany('tenant-1', ['https://exemplo.com']);

    expect(previews[0]?.title).toBe('Título');
    expect(previews[0]?.imageUrl).toBeNull();
  });

  it('deduplicates and caps the number of processed URLs', async () => {
    const { service } = createService();
    mocks.fetchHtmlDocument.mockRejectedValue(new Error('unavailable'));

    await service.resolveMany('tenant-1', [
      'https://a.com',
      'https://a.com',
      'javascript:alert(1)',
      'https://b.com',
      'https://c.com',
      'https://d.com',
    ]);

    expect(mocks.fetchHtmlDocument).toHaveBeenCalledTimes(3);
  });
});
