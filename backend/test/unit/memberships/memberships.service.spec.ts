import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { PasswordService } from '../../../src/modules/auth/password.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import {
  LastOwnerRequiredError,
  MemberPasswordRequiredError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
  TenantAccessDeniedError,
} from '../../../src/modules/memberships/memberships.errors.js';
import { MembershipsService } from '../../../src/modules/memberships/memberships.service.js';

const context: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  membershipId: 'member-a',
  role: 'owner',
};

interface PrismaMock {
  tenantUser: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function createService(): {
  service: MembershipsService;
  prisma: PrismaMock;
  passwords: { hash: ReturnType<typeof vi.fn> };
} {
  const prisma: PrismaMock = {
    tenantUser: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(1),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };

  const tenantContext = {
    requireContext: vi.fn(() => context),
  } as unknown as TenantContextService;

  const passwords = { hash: vi.fn(async () => 'hashed') };

  return {
    service: new MembershipsService(
      prisma as unknown as PrismaService,
      tenantContext,
      passwords as unknown as PasswordService,
    ),
    prisma,
    passwords,
  };
}

describe('MembershipsService', () => {
  it('scopes reads by the tenant from the context', async () => {
    const { service, prisma } = createService();

    await service.listActiveMembers();
    await service.findMember('member-b');

    expect(prisma.tenantUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: context.tenantId, active: true } }),
    );
    expect(prisma.tenantUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-b', tenantId: context.tenantId } }),
    );
  });

  it('scopes deactivation by the tenant from the context', async () => {
    const { service, prisma } = createService();

    await service.deactivateMember('member-b');

    expect(prisma.tenantUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-b', tenantId: context.tenantId } }),
    );
  });

  it('reports not found when a scoped deactivation affects no row', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.deactivateMember('member-b')).rejects.toBeInstanceOf(
      MembershipNotFoundError,
    );
  });

  it('resolves only active memberships', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue(null);

    await expect(service.resolveContext('user-a', 'tenant-b')).rejects.toBeInstanceOf(
      TenantAccessDeniedError,
    );
    expect(prisma.tenantUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-a',
          tenantId: 'tenant-b',
          active: true,
          user: { active: true },
        }),
      }),
    );
  });

  it('builds the context from the resolved membership', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({
      id: 'member-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
      role: 'owner',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.resolveContext('user-a', 'tenant-a')).resolves.toEqual(context);
  });

  it('creates a new user and membership when the email is unknown', async () => {
    const { service, prisma, passwords } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-new', name: 'New', email: 'new@x.com' });
    prisma.tenantUser.findUnique.mockResolvedValue(null);
    prisma.tenantUser.create.mockResolvedValue({
      id: 'member-new',
      userId: 'user-new',
      role: 'ADMIN',
      active: true,
      user: { name: 'New', email: 'new@x.com' },
    });

    const result = await service.createMember({
      name: 'New',
      email: ' New@X.com ',
      password: 'senha12345',
      role: 'ADMIN',
    });

    expect(passwords.hash).toHaveBeenCalledWith('senha12345');
    expect(prisma.tenantUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-new', role: 'ADMIN' }),
      }),
    );
    expect(result).toMatchObject({ id: 'member-new', email: 'new@x.com', role: 'ADMIN' });
  });

  it('requires a password for a brand new user', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.createMember({ name: 'New', email: 'new@x.com', role: 'USER' }),
    ).rejects.toBeInstanceOf(MemberPasswordRequiredError);
  });

  it('rejects adding a user that already belongs to the tenant', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'U', email: 'u@x.com' });
    prisma.tenantUser.findUnique.mockResolvedValue({ id: 'member-1' });

    await expect(
      service.createMember({ name: 'U', email: 'u@x.com', role: 'USER' }),
    ).rejects.toBeInstanceOf(MembershipAlreadyExistsError);
  });

  it('prevents demoting or deactivating the last active owner', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-1', role: 'OWNER', active: true });
    prisma.tenantUser.count.mockResolvedValue(0);

    await expect(service.updateMember('member-1', { role: 'USER' })).rejects.toBeInstanceOf(
      LastOwnerRequiredError,
    );
    await expect(service.updateMember('member-1', { active: false })).rejects.toBeInstanceOf(
      LastOwnerRequiredError,
    );
  });

  it('updates a member role when another owner exists', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-1', role: 'OWNER', active: true });
    prisma.tenantUser.count.mockResolvedValue(1);
    prisma.tenantUser.update.mockResolvedValue({
      id: 'member-1',
      userId: 'user-1',
      role: 'USER',
      active: true,
      user: { name: 'U', email: 'u@x.com' },
    });

    const result = await service.updateMember('member-1', { role: 'USER' });

    expect(result.role).toBe('USER');
  });

  it('blocks removing the last active owner', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-1', role: 'OWNER', active: true });
    prisma.tenantUser.count.mockResolvedValue(0);

    await expect(service.removeMember('member-1')).rejects.toBeInstanceOf(LastOwnerRequiredError);
    expect(prisma.tenantUser.delete).not.toHaveBeenCalled();
  });

  it('removes a regular member scoped by the tenant', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'member-2', role: 'USER', active: true });

    await service.removeMember('member-2');

    expect(prisma.tenantUser.delete).toHaveBeenCalledWith({ where: { id: 'member-2' } });
  });

  it('reports not found when removing an unknown membership', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.findFirst.mockResolvedValue(null);

    await expect(service.removeMember('missing')).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});
