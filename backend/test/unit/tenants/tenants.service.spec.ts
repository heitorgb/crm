import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { TenantNotFoundError } from '../../../src/modules/tenants/tenants.errors.js';
import { TenantsService } from '../../../src/modules/tenants/tenants.service.js';

const context: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

interface PrismaMock {
  tenant: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
}

function createService(): { service: TenantsService; prisma: PrismaMock } {
  const prisma: PrismaMock = {
    tenant: { findUnique: vi.fn(), updateMany: vi.fn() },
  };
  const tenantContext = {
    requireContext: vi.fn(() => context),
  } as unknown as TenantContextService;

  return { service: new TenantsService(prisma as unknown as PrismaService, tenantContext), prisma };
}

describe('TenantsService', () => {
  it('returns the current tenant', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Acme' });

    await expect(service.getCurrent()).resolves.toEqual({ id: 'tenant-1', name: 'Acme' });
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tenant-1' } }),
    );
  });

  it('throws when the current tenant is missing', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(service.getCurrent()).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('renames the current tenant and returns it', async () => {
    const { service, prisma } = createService();
    prisma.tenant.updateMany.mockResolvedValue({ count: 1 });
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Novo Nome' });

    await expect(service.rename({ name: '  Novo Nome  ' })).resolves.toEqual({
      id: 'tenant-1',
      name: 'Novo Nome',
    });
    expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { name: 'Novo Nome' },
    });
  });

  it('reports not found when the tenant update affects no row', async () => {
    const { service, prisma } = createService();
    prisma.tenant.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.rename({ name: 'X' })).rejects.toBeInstanceOf(TenantNotFoundError);
  });
});
