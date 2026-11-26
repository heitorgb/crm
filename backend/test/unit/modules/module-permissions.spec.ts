import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { ModulesService } from '../../../src/modules/modules/modules.service.js';

function catalogEntry(key: string, overrides: { controllable?: boolean; enabled?: boolean } = {}) {
  return {
    id: `id-${key}`, key, name: key, description: null, category: null, icon: null, sortOrder: 0,
    controllable: overrides.controllable ?? true, createdAt: new Date(), updatedAt: new Date(),
    tenants: overrides.enabled === false ? [{ enabled: false }] : [],
  };
}

function createService() {
  const prisma = {
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-1' }) },
    module: {
      findMany: vi.fn().mockResolvedValue([
        catalogEntry('attendance'),
        catalogEntry('crm'),
        catalogEntry('deliveries'),
        catalogEntry('webhooks', { enabled: false }),
        catalogEntry('internal', { controllable: false }),
      ]),
      findUnique: vi.fn(),
    },
    tenantUserModule: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { service: new ModulesService(prisma as unknown as PrismaService), prisma };
}

const member = { tenantId: 'tenant-1', membershipId: 'member-1', role: 'USER' };

describe('ModulesService member permissions', () => {
  it('gives every tenant-enabled module to admins and to members without grants', async () => {
    const { service, prisma } = createService();

    await expect(service.listAvailableKeysForMember({ ...member, role: 'ADMIN' }))
      .resolves.toEqual(['attendance', 'crm', 'deliveries', 'internal']);
    await expect(service.listAvailableKeysForMember(member))
      .resolves.toEqual(['attendance', 'crm', 'deliveries', 'internal']);
    expect(prisma.tenantUserModule.findMany).toHaveBeenCalledTimes(1);
  });

  it('limits a member with grants to those modules, keeping internal modules available', async () => {
    const { service, prisma } = createService();
    prisma.tenantUserModule.findMany.mockResolvedValue([{ module: { key: 'deliveries' } }, { module: { key: 'webhooks' } }]);

    await expect(service.listAvailableKeysForMember(member)).resolves.toEqual(['deliveries', 'internal']);
    expect(prisma.tenantUserModule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', tenantUserId: 'member-1' },
    }));
  });

  it('checks a single module against the member grants', async () => {
    const { service, prisma } = createService();
    prisma.tenantUserModule.findMany.mockResolvedValue([{ module: { key: 'deliveries' } }]);

    await expect(service.isAllowedForMember(member, 'deliveries')).resolves.toBe(true);

    prisma.module.findUnique.mockResolvedValue({ controllable: true });
    await expect(service.isAllowedForMember(member, 'crm')).resolves.toBe(false);

    prisma.module.findUnique.mockResolvedValue({ controllable: false });
    await expect(service.isAllowedForMember(member, 'internal')).resolves.toBe(true);

    await expect(service.isAllowedForMember({ ...member, role: 'OWNER' }, 'crm')).resolves.toBe(true);
  });

  it('only offers enabled, controllable modules for granting', async () => {
    const { service } = createService();
    const grantable = await service.listGrantableForTenant('tenant-1');
    expect(grantable.map((module) => module.key)).toEqual(['attendance', 'crm', 'deliveries']);
  });
});
