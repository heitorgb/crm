import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { PasswordService } from '../../../src/modules/auth/password.service.js';
import {
  LastOwnerRequiredError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
  PasswordRequiredError,
} from '../../../src/modules/admin/admin.errors.js';
import { AdminService } from '../../../src/modules/admin/admin.service.js';

interface PrismaMock {
  $transaction: ReturnType<typeof vi.fn>;
  tenant: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  tenantUser: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

function tenantDetail() {
  return {
    id: 'tenant-1',
    name: 'Acme',
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { members: 1 },
    members: [
      {
        id: 'member-1',
        userId: 'user-1',
        role: 'OWNER',
        active: true,
        createdAt: new Date(),
        user: { name: 'Owner', email: 'owner@x.com' },
      },
    ],
  };
}

function createService() {
  const prisma: PrismaMock = {
    $transaction: vi.fn(),
    tenant: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    tenantUser: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  };

  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (client: PrismaMock) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );

  const passwords = { hash: vi.fn(async () => 'hashed') };

  const service = new AdminService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
  );

  return { service, prisma, passwords };
}

describe('AdminService', () => {
  it('creates a tenant with an owner membership', async () => {
    const { service, prisma, passwords } = createService();
    prisma.tenant.create.mockResolvedValue({ id: 'tenant-1', name: 'Acme' });
    prisma.user.upsert.mockResolvedValue({ id: 'user-1' });
    prisma.tenantUser.create.mockResolvedValue({});
    prisma.tenant.findUnique.mockResolvedValue(tenantDetail());

    const result = await service.createTenantWithOwner({
      name: ' Acme ',
      ownerName: 'Owner',
      ownerEmail: ' Owner@X.com ',
      ownerPassword: 'senha12345',
    });

    expect(passwords.hash).toHaveBeenCalledWith('senha12345');
    expect(prisma.tenant.create).toHaveBeenCalledWith({ data: { name: 'Acme' } });
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'owner@x.com' } }),
    );
    expect(prisma.tenantUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', role: 'OWNER', active: true }),
      }),
    );
    expect(result.members).toHaveLength(1);
  });

  it('requires a password when creating a brand new user', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.addMember('tenant-1', { name: 'New', email: 'new@x.com', role: 'USER' }),
    ).rejects.toBeInstanceOf(PasswordRequiredError);
  });

  it('rejects adding a user that already belongs to the tenant', async () => {
    const { service, prisma } = createService();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.tenantUser.findUnique.mockResolvedValue({ id: 'member-1' });

    await expect(
      service.addMember('tenant-1', { name: 'User', email: 'user@x.com', role: 'USER' }),
    ).rejects.toBeInstanceOf(MembershipAlreadyExistsError);
  });

  it('adds an existing global user without touching the password', async () => {
    const { service, prisma, passwords } = createService();
    prisma.tenant.findUnique
      .mockResolvedValueOnce({ id: 'tenant-1' })
      .mockResolvedValueOnce(tenantDetail());
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.tenantUser.findUnique.mockResolvedValue(null);
    prisma.tenantUser.create.mockResolvedValue({});

    await service.addMember('tenant-1', { name: 'User', email: 'user@x.com', role: 'ADMIN' });

    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.tenantUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) }),
    );
  });

  it('prevents demoting or deactivating the last active owner', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-1', role: 'OWNER', active: true });
    prisma.tenantUser.count.mockResolvedValue(0);

    await expect(
      service.updateMember('tenant-1', 'member-1', { active: false }),
    ).rejects.toBeInstanceOf(LastOwnerRequiredError);
    await expect(
      service.updateMember('tenant-1', 'member-1', { role: 'USER' }),
    ).rejects.toBeInstanceOf(LastOwnerRequiredError);
  });

  it('allows demoting an owner when another active owner exists', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-1', role: 'OWNER', active: true });
    prisma.tenantUser.count.mockResolvedValue(1);
    prisma.tenantUser.update.mockResolvedValue({});
    prisma.tenant.findUnique.mockResolvedValue(tenantDetail());

    await service.updateMember('tenant-1', 'member-1', { role: 'USER' });

    expect(prisma.tenantUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-1' }, data: { role: 'USER' } }),
    );
  });

  it('reports not found when updating an unknown membership', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue(null);

    await expect(
      service.updateMember('tenant-1', 'missing', { active: false }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it('prevents removing the last active owner', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-1', role: 'OWNER', active: true });
    prisma.tenantUser.count.mockResolvedValue(0);

    await expect(service.removeMember('tenant-1', 'member-1')).rejects.toBeInstanceOf(
      LastOwnerRequiredError,
    );
    expect(prisma.tenantUser.delete).not.toHaveBeenCalled();
  });

  it('removes a regular member', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-2', role: 'USER', active: true });
    prisma.tenantUser.delete.mockResolvedValue({});
    prisma.tenant.findUnique.mockResolvedValue(tenantDetail());

    await service.removeMember('tenant-1', 'member-2');

    expect(prisma.tenantUser.delete).toHaveBeenCalledWith({ where: { id: 'member-2' } });
  });
});
