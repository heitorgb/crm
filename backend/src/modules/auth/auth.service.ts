import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { TenantAccessDeniedError } from '../memberships/memberships.errors.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import type { UserMembership } from '../memberships/memberships.service.js';
import {
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  NoActiveMembershipError,
  TenantRequiredError,
  UserInactiveError,
} from './auth.errors.js';
import type { IssuedSession, PublicUser, RequestMetadata } from './auth.types.js';
import type { LoginDto } from './dto/auth.dto.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

interface LoadedUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
  passwordHash: string;
}

export interface CurrentSession {
  user: PublicUser;
  tenant: { id: string; name: string };
  role: Role;
  membershipId: string;
  memberships: UserMembership[];
}

@Injectable()
export class AuthService {
  private cachedDummyHash?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly memberships: MembershipsService,
  ) {}

  async login(dto: LoginDto, meta: RequestMetadata): Promise<IssuedSession> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await this.passwords.verify(await this.dummyHash(), dto.password);
      throw new InvalidCredentialsError();
    }

    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw new InvalidCredentialsError();
    }

    if (!user.active) {
      throw new UserInactiveError();
    }

    const membership = await this.selectMembership(user.id, dto.tenantId);

    return this.issueSession(user, membership, meta);
  }

  async refresh(rawToken: string | undefined, meta: RequestMetadata): Promise<IssuedSession> {
    if (!rawToken) {
      throw new InvalidRefreshTokenError();
    }

    const rotated = await this.refreshTokens.rotate(rawToken, meta);
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });

    if (!user || !user.active) {
      await this.refreshTokens.revoke(rotated.token);
      throw new UserInactiveError();
    }

    const membership = await this.selectMembership(user.id, rotated.tenantId);
    const session = await this.issueAccess(user, membership);

    return {
      ...session,
      refreshToken: rotated.token,
      refreshExpiresAt: rotated.expiresAt,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) {
      await this.refreshTokens.revoke(rawToken);
    }
  }

  async me(context: TenantContext): Promise<CurrentSession> {
    const user = await this.prisma.user.findUnique({ where: { id: context.userId } });

    if (!user || !user.active) {
      throw new UserInactiveError();
    }

    const memberships = await this.memberships.listActiveMembershipsForUser(user.id);
    const current = memberships.find((membership) => membership.tenantId === context.tenantId);

    return {
      user: toPublicUser(user),
      tenant: { id: context.tenantId, name: current?.tenantName ?? '' },
      role: current?.role ?? (context.role as Role),
      membershipId: context.membershipId,
      memberships,
    };
  }

  async switchTenant(
    context: TenantContext,
    tenantId: string,
    meta: RequestMetadata,
    currentRefreshToken: string | undefined,
  ): Promise<IssuedSession> {
    const memberships = await this.memberships.listActiveMembershipsForUser(context.userId);
    const membership = memberships.find((item) => item.tenantId === tenantId);

    if (!membership) {
      throw new TenantAccessDeniedError();
    }

    const user = await this.prisma.user.findUnique({ where: { id: context.userId } });

    if (!user || !user.active) {
      throw new UserInactiveError();
    }

    if (currentRefreshToken) {
      await this.refreshTokens.revoke(currentRefreshToken);
    }

    return this.issueSession(user, membership, meta);
  }

  private async selectMembership(userId: string, tenantId?: string): Promise<UserMembership> {
    const memberships = await this.memberships.listActiveMembershipsForUser(userId);

    if (memberships.length === 0) {
      throw new NoActiveMembershipError();
    }

    if (tenantId) {
      const membership = memberships.find((item) => item.tenantId === tenantId);

      if (!membership) {
        throw new TenantAccessDeniedError();
      }

      return membership;
    }

    if (memberships.length > 1) {
      throw new TenantRequiredError();
    }

    return memberships[0];
  }

  private async issueSession(
    user: LoadedUser,
    membership: UserMembership,
    meta: RequestMetadata,
  ): Promise<IssuedSession> {
    const session = await this.issueAccess(user, membership);
    const refresh = await this.refreshTokens.issue(user.id, membership.tenantId, meta);

    return {
      ...session,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private async issueAccess(
    user: LoadedUser,
    membership: UserMembership,
  ): Promise<Omit<IssuedSession, 'refreshToken' | 'refreshExpiresAt'>> {
    const expiresIn = this.config.getOrThrow('JWT_ACCESS_TTL_SECONDS');

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        tenantId: membership.tenantId,
        membershipId: membership.id,
        role: membership.role,
      },
      { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn },
    );

    return {
      accessToken,
      expiresIn,
      user: toPublicUser(user),
      tenant: { id: membership.tenantId, name: membership.tenantName },
      role: membership.role,
      membershipId: membership.id,
    };
  }

  private async dummyHash(): Promise<string> {
    if (!this.cachedDummyHash) {
      this.cachedDummyHash = await this.passwords.hash(randomUUID());
    }

    return this.cachedDummyHash;
  }
}

function toPublicUser(user: LoadedUser): PublicUser {
  return { id: user.id, name: user.name, email: user.email };
}
