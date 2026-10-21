import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitedError } from '../../common/http/rate-limit/rate-limit.guard.js';
import { RateLimitService } from '../../common/http/rate-limit/rate-limit.service.js';
import type { Env } from '../../config/env.validation.js';
import { EmailService } from '../../infrastructure/email/email.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { InvalidPasswordResetTokenError } from './auth.errors.js';
import type { ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto.js';
import { PasswordService } from './password.service.js';

export const PASSWORD_RESET_REQUEST_MESSAGE =
  'Se existir uma conta associada a esse e-mail, você receberá as instruções para redefinir sua senha.';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const EMAIL_RATE_LIMIT = 3;
const EMAIL_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

interface PasswordResetRequestResult {
  message: string;
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly emails: EmailService,
    private readonly limiter: RateLimitService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async request(dto: ForgotPasswordDto): Promise<PasswordResetRequestResult> {
    this.emails.assertConfigured();

    const email = normalizeEmail(dto.email);
    this.enforceEmailRateLimit(email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, active: true },
    });

    if (!user || !user.active) {
      return { message: PASSWORD_RESET_REQUEST_MESSAGE };
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    ]);

    await this.emails.sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      token,
    });

    return { message: PASSWORD_RESET_REQUEST_MESSAGE };
  }

  async reset(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashToken(dto.token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { active: true } },
      },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      !record.user.active
    ) {
      throw new InvalidPasswordResetTokenError();
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      if (claimed.count === 0) {
        throw new InvalidPasswordResetTokenError();
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });

      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });

      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  private enforceEmailRateLimit(email: string): void {
    const enabled = this.config.get('RATE_LIMIT_ENABLED') ?? true;
    if (!enabled) {
      return;
    }

    const key = `auth-password-reset-email:${hashToken(email)}`;
    if (!this.limiter.hit(key, EMAIL_RATE_LIMIT, EMAIL_RATE_LIMIT_WINDOW_MS)) {
      throw new RateLimitedError();
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
