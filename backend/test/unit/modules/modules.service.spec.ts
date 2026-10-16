import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import {
  ModuleNotFoundError,
  ModuleNotControllableError,
  ModuleTenantNotFoundError,
} from '../../../src/modules/modules/modules.errors.js';
import { ModulesService } from '../../../src/modules/modules/modules.service.js';

interface PrismaMock {
  $transaction: ReturnType<typeof vi.fn>;
  module: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
  tenantModule: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  tenant: { findUnique: ReturnType<typeof vi.fn> };
  adminAuditLog: { create: ReturnType<typeof vi.fn> };
}

function createHarness(): { service: ModulesService; prisma: PrismaMock } {
  const prisma: PrismaMock = {
    $transaction: vi.fn(),
    module: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    tenantModule: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    tenant: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  };

  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (client: PrismaMock) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );

  const service = new ModulesService(prisma as unknown as PrismaService);
  return { service, prisma };
}

const catalogModule = {
  id: 'module-1',
  key: 'billing.collection',
  name: 'Régua de Cobrança',
  description: null,
  category: 'Financeiro',
  icon: null,
  sortOrder: 40,
  controllable: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ModulesService.isEnabled', () => {
  it('treats a module without an explicit tenant row as enabled', async () => {
    const { service, prisma } = createHarness();
    prisma.module.findUnique.mockResolvedValue({ id: 'module-1', controllable: true });
    prisma.tenantModule.findUnique.mockResolvedValue(null);

    await expect(service.isEnabled('tenant-1', 'billing.collection')).resolves.toBe(true);
  });

  it('returns false when the tenant explicitly disabled the module', async () => {
    const { service, prisma } = createHarness();
    prisma.module.findUnique.mockResolvedValue({ id: 'module-1', controllable: true });
    prisma.tenantModule.findUnique.mockResolvedValue({ enabled: false });

    await expect(service.isEnabled('tenant-1', 'billing.collection')).resolves.toBe(false);
  });

  it('always enables a non-controllable module', async () => {
    const { service, prisma } = createHarness();
    prisma.module.findUnique.mockResolvedValue({ id: 'module-1', controllable: false });

    await expect(service.isEnabled('tenant-1', 'billing.collection')).resolves.toBe(true);
    expect(prisma.tenantModule.findUnique).not.toHaveBeenCalled();
  });

  it('fails open for an unknown module key', async () => {
    const { service, prisma } = createHarness();
    prisma.module.findUnique.mockResolvedValue(null);

    await expect(service.isEnabled('tenant-1', 'unknown.module')).resolves.toBe(true);
  });
});

describe('ModulesService.listForTenant', () => {
  it('merges the catalog with the tenant state and defaults to enabled', async () => {
    const { service, prisma } = createHarness();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.module.findMany.mockResolvedValue([
      { ...catalogModule, tenants: [{ enabled: false }] },
      {
        ...catalogModule,
        id: 'module-2',
        key: 'contacts',
        name: 'Contatos',
        tenants: [],
      },
    ]);

    const result = await service.listForTenant('tenant-1');

    expect(result).toEqual([
      expect.objectContaining({ key: 'billing.collection', enabled: false }),
      expect.objectContaining({ key: 'contacts', enabled: true }),
    ]);
  });

  it('rejects an unknown tenant', async () => {
    const { service, prisma } = createHarness();
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(service.listForTenant('missing')).rejects.toBeInstanceOf(
      ModuleTenantNotFoundError,
    );
  });
});

describe('ModulesService.setModuleEnabledForTenant', () => {
  it('upserts the state and records an audit entry', async () => {
    const { service, prisma } = createHarness();
    prisma.module.findUnique.mockResolvedValue({ id: 'module-1', controllable: true });
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.tenantModule.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ enabled: false });
    prisma.module.findUniqueOrThrow.mockResolvedValue(catalogModule);

    const result = await service.setModuleEnabledForTenant({
      tenantId: 'tenant-1',
      moduleKey: 'billing.collection',
      enabled: false,
      actorUserId: 'admin-1',
    });

    expect(result.enabled).toBe(false);
    expect(prisma.tenantModule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_moduleId: { tenantId: 'tenant-1', moduleId: 'module-1' } },
        update: { enabled: false },
        create: { tenantId: 'tenant-1', moduleId: 'module-1', enabled: false },
      }),
    );
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          tenantId: 'tenant-1',
          action: 'MODULE_DISABLED',
          entity: 'module',
          entityId: 'billing.collection',
        }),
      }),
    );
  });

  it('rejects an unknown module', async () => {
    const { service, prisma } = createHarness();
    prisma.module.findUnique.mockResolvedValue(null);

    await expect(
      service.setModuleEnabledForTenant({
        tenantId: 'tenant-1',
        moduleKey: 'unknown',
        enabled: false,
        actorUserId: 'admin-1',
      }),
    ).rejects.toBeInstanceOf(ModuleNotFoundError);
  });

  it('rejects a non-controllable module', async () => {
    const { service, prisma } = createHarness();
    prisma.module.findUnique.mockResolvedValue({ id: 'module-1', controllable: false });

    await expect(
      service.setModuleEnabledForTenant({
        tenantId: 'tenant-1',
        moduleKey: 'billing.collection',
        enabled: false,
        actorUserId: 'admin-1',
      }),
    ).rejects.toBeInstanceOf(ModuleNotControllableError);
  });
});
