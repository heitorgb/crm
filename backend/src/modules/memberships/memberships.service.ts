import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { MembershipNotFoundError, TenantAccessDeniedError } from './memberships.errors.js';

export interface MembershipSummary {
  id: string;
  tenantId: string;
  userId: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberWithUser {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

export interface UserMembership {
  id: string;
  tenantId: string;
  tenantName: string;
  role: Role;
  active: boolean;
}

const MEMBERSHIP_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantUserSelect;

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async resolveContext(userId: string, tenantId: string): Promise<TenantContext> {
    const membership = await this.prisma.tenantUser.findFirst({
      where: { userId, tenantId, active: true, user: { active: true } },
      select: MEMBERSHIP_SELECT,
    });

    if (!membership) {
      throw new TenantAccessDeniedError();
    }

    return {
      tenantId: membership.tenantId,
      userId: membership.userId,
      membershipId: membership.id,
      role: membership.role,
    };
  }

  async listActiveMembershipsForUser(userId: string): Promise<UserMembership[]> {
    const memberships = await this.prisma.tenantUser.findMany({
      where: { userId, active: true },
      select: {
        id: true,
        tenantId: true,
        role: true,
        active: true,
        tenant: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      tenantId: membership.tenantId,
      tenantName: membership.tenant.name,
      role: membership.role,
      active: membership.active,
    }));
  }

  async listActiveMembers(): Promise<MembershipSummary[]> {
    const { tenantId } = this.tenantContext.requireContext();

    return this.prisma.tenantUser.findMany({
      where: { tenantId, active: true },
      select: MEMBERSHIP_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async listMembersWithUsers(): Promise<MemberWithUser[]> {
    const { tenantId } = this.tenantContext.requireContext();

    const members = await this.prisma.tenantUser.findMany({
      where: { tenantId, active: true, user: { active: true } },
      select: {
        id: true,
        userId: true,
        role: true,
        active: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      active: member.active,
    }));
  }

  async findMember(membershipId: string): Promise<MembershipSummary | null> {
    const { tenantId } = this.tenantContext.requireContext();

    return this.prisma.tenantUser.findFirst({
      where: { id: membershipId, tenantId },
      select: MEMBERSHIP_SELECT,
    });
  }

  async deactivateMember(membershipId: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();

    const result = await this.prisma.tenantUser.updateMany({
      where: { id: membershipId, tenantId },
      data: { active: false },
    });

    if (result.count === 0) {
      throw new MembershipNotFoundError();
    }
  }

  async removeMember(membershipId: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();

    const result = await this.prisma.tenantUser.deleteMany({
      where: { id: membershipId, tenantId },
    });

    if (result.count === 0) {
      throw new MembershipNotFoundError();
    }
  }
}
