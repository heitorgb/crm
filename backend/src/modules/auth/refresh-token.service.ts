import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  InvalidRefreshTokenError,
  RefreshTokenExpiredError,
  RefreshTokenReuseError,
} from './auth.errors.js';
import type { RequestMetadata } from './auth.types.js';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken {
  userId: string;
  tenantId: string;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(userId: string, tenantId: string, meta: RequestMetadata): Promise<IssuedRefreshToken> {
    return this.createToken(userId, tenantId, randomUUID(), meta);
  }

  async rotate(rawToken: string, meta: RequestMetadata): Promise<RotatedRefreshToken> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    if (!record) {
      throw new InvalidRefreshTokenError();
    }

    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      throw new RefreshTokenReuseError();
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new RefreshTokenExpiredError();
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (claimed.count === 0) {
      await this.revokeFamily(record.familyId);
      throw new RefreshTokenReuseError();
    }

    const created = await this.createToken(record.userId, record.tenantId, record.familyId, meta);

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { replacedByTokenId: created.id },
    });

    return {
      userId: record.userId,
      tenantId: record.tenantId,
      token: created.token,
      expiresAt: created.expiresAt,
    };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createToken(
    userId: string,
    tenantId: string,
    familyId: string,
    meta: RequestMetadata,
  ): Promise<{ id: string } & IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = this.expiryFromNow();

    const { id } = await this.prisma.refreshToken.create({
      data: {
        userId,
        tenantId,
        tokenHash: this.hashToken(token),
        familyId,
        expiresAt,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
      select: { id: true },
    });

    return { id, token, expiresAt };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private expiryFromNow(): Date {
    const ttlDays = this.config.getOrThrow('REFRESH_TOKEN_TTL_DAYS');
    return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
