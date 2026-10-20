import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { PlatformSettingsService } from '../../../src/modules/platform-settings/platform-settings.service.js';

interface PrismaMock {
  $transaction: ReturnType<typeof vi.fn>;
  platformSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  adminAuditLog: {
    create: ReturnType<typeof vi.fn>;
  };
}

function createService(): { service: PlatformSettingsService; prisma: PrismaMock } {
  const prisma: PrismaMock = {
    $transaction: vi.fn(),
    platformSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };

  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (client: PrismaMock) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );

  return {
    service: new PlatformSettingsService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('PlatformSettingsService', () => {
  it('starts with link previews disabled when no settings row exists', async () => {
    const { service, prisma } = createService();
    prisma.platformSettings.findUnique.mockResolvedValue(null);

    await expect(service.get()).resolves.toEqual({ linkPreviewsEnabled: false });
    await expect(service.isLinkPreviewsEnabled()).resolves.toBe(false);
  });

  it('persists the global toggle and writes an audit entry', async () => {
    const { service, prisma } = createService();
    prisma.platformSettings.findUnique.mockResolvedValue({ linkPreviewsEnabled: false });
    prisma.platformSettings.upsert.mockResolvedValue({ linkPreviewsEnabled: true });

    const result = await service.update({ linkPreviewsEnabled: true }, 'admin-user');

    expect(result).toEqual({ linkPreviewsEnabled: true });
    expect(prisma.platformSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'global' },
        update: { linkPreviewsEnabled: true },
        create: { id: 'global', linkPreviewsEnabled: true },
      }),
    );
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'admin-user',
          action: 'PLATFORM_SETTINGS_UPDATED',
          metadata: {
            previousLinkPreviewsEnabled: false,
            linkPreviewsEnabled: true,
          },
        }),
      }),
    );
  });
});
