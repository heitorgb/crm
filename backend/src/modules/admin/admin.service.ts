import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { normalizeEmail } from '../../common/security/platform-admin.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import {
  LastOwnerRequiredError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
  PasswordRequiredError,
  TenantNotFoundError,
} from './admin.errors.js';
import type {
  AddMemberDto,
  CreateTenantDto,
  ListTenantsQueryDto,
  ListUsersQueryDto,
  UpdateMemberDto,
} from './dto/admin.dto.js';

export interface TenantSummaryView {
  id: string;
  name: string;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date;
}

export interface TenantDetailView extends TenantSummaryView {
  members: TenantMemberView[];
}

export interface AdminUserView {
  id: string;
  name: string;
  email: string;
  active: boolean;
  membershipsCount: number;
  createdAt: Date;
}

type TenantWithCount = Prisma.TenantGetPayload<{
  include: { _count: { select: { members: true } } };
}>;

type MemberWithUser = Prisma.TenantUserGetPayload<{
  select: {
    id: true;
    userId: true;
    role: true;
    active: true;
    createdAt: true;
    user: { select: { name: true; email: true } };
  };
}>;

type UserWithCount = Prisma.UserGetPayload<{
  select: {
    id: true;
    name: true;
    email: true;
    active: true;
    createdAt: true;
    _count: { select: { memberships: true } };
  };
}>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async listTenants(query: ListTenantsQueryDto): Promise<PageResult<TenantSummaryView>> {
    const where: Prisma.TenantWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};

    const [total, tenants] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: { _count: { select: { members: true } } },
      }),
    ]);

    return buildPage(tenants.map(toTenantSummary), total, query.page, query.perPage);
  }

  async getTenant(id: string): Promise<TenantDetailView> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true } },
        members: {
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            userId: true,
            role: true,
            active: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!tenant) {
      throw new TenantNotFoundError();
    }

    return { ...toTenantSummary(tenant), members: tenant.members.map(toMember) };
  }

  async createTenantWithOwner(dto: CreateTenantDto): Promise<TenantDetailView> {
    const email = normalizeEmail(dto.ownerEmail);
    const passwordHash = await this.passwords.hash(dto.ownerPassword);

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({ data: { name: dto.name.trim() } });

      const user = await tx.user.upsert({
        where: { email },
        update: { active: true },
        create: { email, name: dto.ownerName.trim(), passwordHash },
        select: { id: true },
      });

      await tx.tenantUser.create({
        data: { tenantId: created.id, userId: user.id, role: Role.OWNER, active: true },
      });

      return created;
    });

    return this.getTenant(tenant.id);
  }

  async addMember(tenantId: string, dto: AddMemberDto): Promise<TenantDetailView> {
    await this.requireTenant(tenantId);
    const email = normalizeEmail(dto.email);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    let userId = existing?.id;
    if (!userId) {
      if (!dto.password) {
        throw new PasswordRequiredError();
      }
      const passwordHash = await this.passwords.hash(dto.password);
      const created = await this.prisma.user.create({
        data: { email, name: dto.name.trim(), passwordHash },
        select: { id: true },
      });
      userId = created.id;
    }

    const alreadyMember = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new MembershipAlreadyExistsError();
    }

    try {
      await this.prisma.tenantUser.create({
        data: { tenantId, userId, role: dto.role, active: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new MembershipAlreadyExistsError();
      }
      throw error;
    }

    return this.getTenant(tenantId);
  }

  async updateMember(
    tenantId: string,
    membershipId: string,
    dto: UpdateMemberDto,
  ): Promise<TenantDetailView> {
    const membership = await this.prisma.tenantUser.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true, role: true, active: true },
    });

    if (!membership) {
      throw new MembershipNotFoundError();
    }

    const losingOwner =
      membership.role === Role.OWNER &&
      membership.active &&
      ((dto.role !== undefined && dto.role !== Role.OWNER) || dto.active === false);

    if (losingOwner) {
      await this.ensureNotLastOwner(tenantId, membershipId);
    }

    await this.prisma.tenantUser.update({
      where: { id: membershipId },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });

    return this.getTenant(tenantId);
  }

  async removeMember(tenantId: string, membershipId: string): Promise<TenantDetailView> {
    const membership = await this.prisma.tenantUser.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true, role: true, active: true },
    });

    if (!membership) {
      throw new MembershipNotFoundError();
    }

    if (membership.role === Role.OWNER && membership.active) {
      await this.ensureNotLastOwner(tenantId, membershipId);
    }

    await this.prisma.tenantUser.delete({ where: { id: membershipId } });

    return this.getTenant(tenantId);
  }

  async listUsers(query: ListUsersQueryDto): Promise<PageResult<AdminUserView>> {
    const where: Prisma.UserWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
          createdAt: true,
          _count: { select: { memberships: true } },
        },
      }),
    ]);

    return buildPage(users.map(toAdminUser), total, query.page, query.perPage);
  }

  private async requireTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new TenantNotFoundError();
    }
  }

  private async ensureNotLastOwner(tenantId: string, membershipId: string): Promise<void> {
    const otherOwners = await this.prisma.tenantUser.count({
      where: {
        tenantId,
        role: Role.OWNER,
        active: true,
        id: { not: membershipId },
      },
    });

    if (otherOwners === 0) {
      throw new LastOwnerRequiredError();
    }
  }
}

function toTenantSummary(tenant: TenantWithCount): TenantSummaryView {
  return {
    id: tenant.id,
    name: tenant.name,
    memberCount: tenant._count.members,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

function toMember(member: MemberWithUser): TenantMemberView {
  return {
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    active: member.active,
    createdAt: member.createdAt,
  };
}

function toAdminUser(user: UserWithCount): AdminUserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    active: user.active,
    membershipsCount: user._count.memberships,
    createdAt: user.createdAt,
  };
}
