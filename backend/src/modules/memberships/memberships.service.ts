import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { userAvatarUrl } from '../../common/user-avatar.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import { AvatarNotFoundError } from '../auth/auth.errors.js';
import { PasswordService } from '../auth/password.service.js';
import type { CreateMemberDto, UpdateMemberDto } from './dto/member.dto.js';
import {
  LastOwnerRequiredError,
  MemberPasswordRequiredError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
  TenantAccessDeniedError,
} from './memberships.errors.js';

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
  avatarUrl: string | null;
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

const MEMBER_WITH_USER_SELECT = {
  id: true,
  userId: true,
  role: true,
  active: true,
  user: { select: { name: true, email: true, avatarUpdatedAt: true } },
} satisfies Prisma.TenantUserSelect;

type PrismaMemberWithUser = Prisma.TenantUserGetPayload<{
  select: typeof MEMBER_WITH_USER_SELECT;
}>;

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly passwords: PasswordService,
    @Inject(STORAGE) private readonly storage: StorageService,
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
        user: { select: { name: true, email: true, avatarUpdatedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      avatarUrl: userAvatarUrl(member.id, member.user.avatarUpdatedAt),
      role: member.role,
      active: member.active,
    }));
  }

  async readAvatar(membershipId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const { tenantId } = this.tenantContext.requireContext();
    const membership = await this.prisma.tenantUser.findFirst({
      where: { id: membershipId, tenantId, active: true, user: { active: true } },
      select: { user: { select: { avatarStorageKey: true } } },
    });

    if (!membership?.user.avatarStorageKey) {
      throw new AvatarNotFoundError();
    }

    try {
      return {
        buffer: await this.storage.get(membership.user.avatarStorageKey),
        mimeType: 'image/jpeg',
      };
    } catch {
      throw new AvatarNotFoundError();
    }
  }

  async createMember(dto: CreateMemberDto): Promise<MemberWithUser> {
    const { tenantId } = this.tenantContext.requireContext();
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });

    let user = existing;
    if (!user) {
      if (!dto.password) {
        throw new MemberPasswordRequiredError();
      }
      const passwordHash = await this.passwords.hash(dto.password);
      user = await this.prisma.user.create({
        data: { email, name: dto.name.trim(), passwordHash },
        select: { id: true, name: true, email: true },
      });
    }

    const alreadyMember = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new MembershipAlreadyExistsError();
    }

    try {
      const membership = await this.prisma.tenantUser.create({
        data: { tenantId, userId: user.id, role: dto.role, active: true },
        select: MEMBER_WITH_USER_SELECT,
      });
      return toMemberWithUser(membership);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new MembershipAlreadyExistsError();
      }
      throw error;
    }
  }

  async updateMember(membershipId: string, dto: UpdateMemberDto): Promise<MemberWithUser> {
    const { tenantId } = this.tenantContext.requireContext();
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

    const updated = await this.prisma.tenantUser.update({
      where: { id: membershipId },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      select: MEMBER_WITH_USER_SELECT,
    });

    return toMemberWithUser(updated);
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
  }

  private async ensureNotLastOwner(tenantId: string, membershipId: string): Promise<void> {
    const otherOwners = await this.prisma.tenantUser.count({
      where: { tenantId, role: Role.OWNER, active: true, id: { not: membershipId } },
    });

    if (otherOwners === 0) {
      throw new LastOwnerRequiredError();
    }
  }
}

function toMemberWithUser(member: PrismaMemberWithUser): MemberWithUser {
  return {
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    avatarUrl: userAvatarUrl(member.id, member.user.avatarUpdatedAt),
    role: member.role,
    active: member.active,
  };
}
