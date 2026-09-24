import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import {
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
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
}

function createService(): { service: MembershipsService; prisma: PrismaMock } {
  const prisma: PrismaMock = {
    tenantUser: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const tenantContext = {
    requireContext: vi.fn(() => context),
  } as unknown as TenantContextService;

  return {
    service: new MembershipsService(prisma as unknown as PrismaService, tenantContext),
    prisma,
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

  it('scopes updates and deletes by the tenant from the context', async () => {
    const { service, prisma } = createService();

    await service.deactivateMember('member-b');
    await service.removeMember('member-b');

    expect(prisma.tenantUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-b', tenantId: context.tenantId } }),
    );
    expect(prisma.tenantUser.deleteMany).toHaveBeenCalledWith({
      where: { id: 'member-b', tenantId: context.tenantId },
    });
  });

  it('reports not found when a scoped mutation affects no row', async () => {
    const { service, prisma } = createService();
    prisma.tenantUser.updateMany.mockResolvedValue({ count: 0 });
    prisma.tenantUser.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.deactivateMember('member-b')).rejects.toBeInstanceOf(MembershipNotFoundError);
    await expect(service.removeMember('member-b')).rejects.toBeInstanceOf(MembershipNotFoundError);
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
});
