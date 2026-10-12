import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { InvalidAccessTokenError } from '../../../src/modules/auth/auth.errors.js';
import { PlatformAdminRequiredError } from '../../../src/modules/admin/admin.errors.js';
import { PlatformAdminGuard } from '../../../src/modules/admin/platform-admin.guard.js';
import { isPlatformAdminEmail } from '../../../src/common/security/platform-admin.js';

const tenant = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

interface Harness {
  guard: PlatformAdminGuard;
  tenantContext: TenantContextService;
  prisma: { user: { findUnique: ReturnType<typeof vi.fn> } };
  config: { get: ReturnType<typeof vi.fn> };
}

function createHarness(): Harness {
  const prisma = { user: { findUnique: vi.fn() } };
  const config = { get: vi.fn(() => ['admin@orderup.local']) };
  const tenantContext = new TenantContextService();

  const guard = new PlatformAdminGuard(
    tenantContext,
    prisma as unknown as PrismaService,
    config as unknown as ConfigService<Env, true>,
  );

  return { guard, tenantContext, prisma, config };
}

describe('isPlatformAdminEmail', () => {
  it('matches case-insensitively and trims', () => {
    expect(isPlatformAdminEmail(' Admin@OrderUp.local ', ['admin@orderup.local'])).toBe(true);
    expect(isPlatformAdminEmail('other@x.com', ['admin@orderup.local'])).toBe(false);
  });
});

describe('PlatformAdminGuard', () => {
  it('rejects when there is no tenant context', async () => {
    const { guard } = createHarness();

    await expect(guard.canActivate()).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects when the allowlist is empty', async () => {
    const { guard, tenantContext, config } = createHarness();
    config.get.mockReturnValue([]);

    await tenantContext.run({ tenant }, async () => {
      await expect(guard.canActivate()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
    });
  });

  it('rejects a user outside the allowlist', async () => {
    const { guard, tenantContext, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue({ email: 'someone@x.com', active: true });

    await tenantContext.run({ tenant }, async () => {
      await expect(guard.canActivate()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
    });
  });

  it('rejects an inactive admin user', async () => {
    const { guard, tenantContext, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue({ email: 'admin@orderup.local', active: false });

    await tenantContext.run({ tenant }, async () => {
      await expect(guard.canActivate()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
    });
  });

  it('allows an active admin in the allowlist', async () => {
    const { guard, tenantContext, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue({ email: 'admin@orderup.local', active: true });

    await tenantContext.run({ tenant }, async () => {
      await expect(guard.canActivate()).resolves.toBe(true);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          select: { email: true, active: true },
        }),
      );
    });
  });
});
