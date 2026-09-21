import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module.js';
import { TenantContextService } from '../../src/common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../src/common/tenant-context/tenant-context.types.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import {
  MembershipNotFoundError,
  TenantAccessDeniedError,
} from '../../src/modules/memberships/memberships.errors.js';
import { MembershipsModule } from '../../src/modules/memberships/memberships.module.js';
import { MembershipsService } from '../../src/modules/memberships/memberships.service.js';

interface Seeded {
  tenantA: { id: string };
  tenantB: { id: string };
  userA: { id: string };
  userB: { id: string };
  userInactive: { id: string };
  memberA: { id: string; tenantId: string; userId: string; role: string };
  memberB: { id: string; tenantId: string; userId: string; role: string };
  inactiveMemberA: { id: string };
}

describe('Tenant isolation (integration)', () => {
  let prisma: PrismaService;
  let memberships: MembershipsService;
  let tenantContext: TenantContextService;
  let closeModule: () => Promise<void>;
  let data!: Seeded;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
        TenantContextModule,
        MembershipsModule,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    memberships = moduleRef.get(MembershipsService);
    tenantContext = moduleRef.get(TenantContextService);
    closeModule = () => moduleRef.close();
  });

  afterAll(async () => {
    await closeModule();
  });

  beforeEach(async () => {
    data = await seed(prisma);
  });

  afterEach(async () => {
    await cleanup(prisma, data);
  });

  const contextOf = (member: { id: string; tenantId: string; userId: string; role: string }): TenantContext => ({
    tenantId: member.tenantId,
    userId: member.userId,
    membershipId: member.id,
    role: member.role,
  });

  const runAs = <T>(context: TenantContext, fn: () => Promise<T>): Promise<T> =>
    tenantContext.run({ tenant: context }, fn);

  describe('resolveContext (membership validation)', () => {
    it('resolves a context for the correct tenant', async () => {
      await expect(memberships.resolveContext(data.userA.id, data.tenantA.id)).resolves.toEqual(
        contextOf(data.memberA),
      );
      await expect(memberships.resolveContext(data.userB.id, data.tenantB.id)).resolves.toEqual(
        contextOf(data.memberB),
      );
    });

    it('denies a user requesting another tenant', async () => {
      await expect(memberships.resolveContext(data.userA.id, data.tenantB.id)).rejects.toBeInstanceOf(
        TenantAccessDeniedError,
      );
      await expect(memberships.resolveContext(data.userB.id, data.tenantA.id)).rejects.toBeInstanceOf(
        TenantAccessDeniedError,
      );
    });

    it('denies an inactive membership', async () => {
      await expect(
        memberships.resolveContext(data.userInactive.id, data.tenantA.id),
      ).rejects.toBeInstanceOf(TenantAccessDeniedError);
    });

    it('denies a membership that does not exist', async () => {
      await expect(memberships.resolveContext(randomUUID(), data.tenantA.id)).rejects.toBeInstanceOf(
        TenantAccessDeniedError,
      );
    });
  });

  describe('read isolation', () => {
    it('A -> A is allowed and B -> B is allowed', async () => {
      const membersOfA = await runAs(contextOf(data.memberA), () => memberships.listActiveMembers());
      const membersOfB = await runAs(contextOf(data.memberB), () => memberships.listActiveMembers());

      expect(membersOfA.map((member) => member.id)).toContain(data.memberA.id);
      expect(membersOfA.map((member) => member.id)).not.toContain(data.memberB.id);
      expect(membersOfB.map((member) => member.id)).toContain(data.memberB.id);
      expect(membersOfB.map((member) => member.id)).not.toContain(data.memberA.id);
    });

    it('A -> B is denied and B -> A is denied', async () => {
      const fromA = await runAs(contextOf(data.memberA), () => memberships.findMember(data.memberB.id));
      const fromB = await runAs(contextOf(data.memberB), () => memberships.findMember(data.memberA.id));

      expect(fromA).toBeNull();
      expect(fromB).toBeNull();
    });
  });

  describe('write isolation', () => {
    it('A -> A update is allowed', async () => {
      await runAs(contextOf(data.memberA), () => memberships.deactivateMember(data.memberA.id));

      const updated = await prisma.tenantUser.findUnique({ where: { id: data.memberA.id } });
      expect(updated?.active).toBe(false);
    });

    it('A -> B update is denied and does not mutate B', async () => {
      await expect(
        runAs(contextOf(data.memberA), () => memberships.deactivateMember(data.memberB.id)),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);

      const untouched = await prisma.tenantUser.findUnique({ where: { id: data.memberB.id } });
      expect(untouched?.active).toBe(true);
    });

    it('A -> B delete is denied and does not remove B', async () => {
      await expect(
        runAs(contextOf(data.memberA), () => memberships.removeMember(data.memberB.id)),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);

      const stillThere = await prisma.tenantUser.findUnique({ where: { id: data.memberB.id } });
      expect(stillThere).not.toBeNull();
    });

    it('A -> A delete is allowed', async () => {
      await runAs(contextOf(data.memberA), () => memberships.removeMember(data.memberA.id));

      const removed = await prisma.tenantUser.findUnique({ where: { id: data.memberA.id } });
      expect(removed).toBeNull();
    });
  });
});

async function seed(prisma: PrismaService): Promise<Seeded> {
  const suffix = randomUUID();

  const tenantA = await prisma.tenant.create({ data: { name: `Tenant A ${suffix}` } });
  const tenantB = await prisma.tenant.create({ data: { name: `Tenant B ${suffix}` } });

  const userA = await prisma.user.create({
    data: { email: `a-${suffix}@example.com`, passwordHash: 'hash', name: 'User A' },
  });
  const userB = await prisma.user.create({
    data: { email: `b-${suffix}@example.com`, passwordHash: 'hash', name: 'User B' },
  });
  const userInactive = await prisma.user.create({
    data: { email: `i-${suffix}@example.com`, passwordHash: 'hash', name: 'User Inactive' },
  });

  const memberA = await prisma.tenantUser.create({
    data: { tenantId: tenantA.id, userId: userA.id, role: 'OWNER', active: true },
  });
  const memberB = await prisma.tenantUser.create({
    data: { tenantId: tenantB.id, userId: userB.id, role: 'OWNER', active: true },
  });
  const inactiveMemberA = await prisma.tenantUser.create({
    data: { tenantId: tenantA.id, userId: userInactive.id, role: 'USER', active: false },
  });

  return {
    tenantA,
    tenantB,
    userA,
    userB,
    userInactive,
    memberA,
    memberB,
    inactiveMemberA,
  };
}

async function cleanup(prisma: PrismaService, data: Seeded): Promise<void> {
  await prisma.tenantUser.deleteMany({
    where: { id: { in: [data.memberA.id, data.memberB.id, data.inactiveMemberA.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [data.userA.id, data.userB.id, data.userInactive.id] } },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: [data.tenantA.id, data.tenantB.id] } } });
}
