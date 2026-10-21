import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { RateLimitedError } from '../../../src/common/http/rate-limit/rate-limit.guard.js';
import { RateLimitService } from '../../../src/common/http/rate-limit/rate-limit.service.js';
import type { Env } from '../../../src/config/env.validation.js';
import {
  EmailDeliveryError,
  EmailNotConfiguredError,
} from '../../../src/infrastructure/email/email.errors.js';
import type { EmailService } from '../../../src/infrastructure/email/email.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { InvalidPasswordResetTokenError } from '../../../src/modules/auth/auth.errors.js';
import { PasswordResetService } from '../../../src/modules/auth/password-reset.service.js';
import type { PasswordService } from '../../../src/modules/auth/password.service.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createHarness(options: { rateLimitEnabled?: boolean } = {}) {
  const tx = {
    passwordResetToken: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: {
      update: vi.fn(async () => ({})),
    },
    refreshToken: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };

  const prisma = {
    user: { findUnique: vi.fn() },
    passwordResetToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async (..._args: unknown[]) => ({})),
    },
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (client: typeof tx) => Promise<unknown>)(tx);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  };

  const passwords = {
    hash: vi.fn(async () => 'new-hash'),
    verify: vi.fn(),
  };

  const emails = {
    assertConfigured: vi.fn(),
    sendPasswordResetEmail: vi.fn(async (..._args: unknown[]) => undefined),
  };

  const limiter = new RateLimitService();
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'RATE_LIMIT_ENABLED') {
        return options.rateLimitEnabled ?? false;
      }
      return undefined;
    }),
  };

  const service = new PasswordResetService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    emails as unknown as EmailService,
    limiter,
    config as unknown as ConfigService<Env, true>,
  );

  return { service, prisma, tx, passwords, emails, limiter };
}

describe('PasswordResetService.request', () => {
  it('stores only the hash of a 32-byte token and sends the raw token by e-mail', async () => {
    const { service, prisma, emails } = createHarness();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Ana',
      email: 'ana@example.com',
      active: true,
    });

    const before = Date.now();
    const result = await service.request({ email: '  ANA@Example.com ' });

    expect(result.message).toContain('Se existir uma conta associada a esse e-mail');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'ana@example.com' },
      select: { id: true, name: true, email: true, active: true },
    });

    const createCall = prisma.passwordResetToken.create.mock.calls[0] as unknown as [
      { data: { tokenHash: string; expiresAt: Date } },
    ];
    const createData = createCall[0].data;
    const sentCall = emails.sendPasswordResetEmail.mock.calls[0] as unknown as [
      { token: string; to: string },
    ];
    const sent = sentCall[0];

    expect(sent.to).toBe('ana@example.com');
    expect(sent.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createData.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createData.tokenHash).toBe(hashToken(sent.token));
    expect(createData.tokenHash).not.toBe(sent.token);
    expect(createData.expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    expect(createData.expiresAt.getTime() - before).toBeLessThan(30 * 60 * 1000 + 5000);
    expect(emails.assertConfigured).toHaveBeenCalled();
  });

  it('invalidates previous pending tokens before issuing a new one', async () => {
    const { service, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Ana',
      email: 'ana@example.com',
      active: true,
    });

    await service.request({ email: 'ana@example.com' });

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
  });

  it('returns the same generic response for unknown or inactive accounts without sending e-mail', async () => {
    const unknown = createHarness();
    unknown.prisma.user.findUnique.mockResolvedValue(null);

    const unknownResult = await unknown.service.request({ email: 'ghost@example.com' });

    expect(unknownResult.message).toContain('Se existir uma conta associada a esse e-mail');
    expect(unknown.emails.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(unknown.prisma.passwordResetToken.create).not.toHaveBeenCalled();

    const inactive = createHarness();
    inactive.prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      name: 'Inactive',
      email: 'inactive@example.com',
      active: false,
    });

    const inactiveResult = await inactive.service.request({ email: 'inactive@example.com' });

    expect(inactiveResult.message).toBe(unknownResult.message);
    expect(inactive.emails.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(inactive.prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('fails safely when e-mail is not configured or delivery fails', async () => {
    const notConfigured = createHarness();
    notConfigured.emails.assertConfigured.mockImplementation(() => {
      throw new EmailNotConfiguredError();
    });

    await expect(
      notConfigured.service.request({ email: 'ana@example.com' }),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(notConfigured.prisma.user.findUnique).not.toHaveBeenCalled();

    const deliveryFailure = createHarness();
    deliveryFailure.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Ana',
      email: 'ana@example.com',
      active: true,
    });
    deliveryFailure.emails.sendPasswordResetEmail.mockRejectedValue(new EmailDeliveryError());

    await expect(
      deliveryFailure.service.request({ email: 'ana@example.com' }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it('limits repeated requests for the same address when rate limiting is enabled', async () => {
    const { service, prisma } = createHarness({ rateLimitEnabled: true });
    prisma.user.findUnique.mockResolvedValue(null);

    await service.request({ email: 'ana@example.com' });
    await service.request({ email: 'ana@example.com' });
    await service.request({ email: 'ana@example.com' });

    await expect(service.request({ email: 'ANA@example.com' })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });
});

describe('PasswordResetService.reset', () => {
  it('hashes the new password, consumes the token and revokes refresh sessions atomically', async () => {
    const { service, prisma, tx, passwords } = createHarness();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { active: true },
    });

    await service.reset({ token: 'raw-token', newPassword: 'nova-senha-123' });

    expect(passwords.hash).toHaveBeenCalledWith('nova-senha-123');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.passwordResetToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'reset-1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash' },
    });
    expect(tx.passwordResetToken.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects missing, used, expired and inactive-user tokens without hashing a password', async () => {
    const cases = [
      null,
      {
        id: 'reset-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        user: { active: true },
      },
      {
        id: 'reset-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        user: { active: true },
      },
      {
        id: 'reset-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        user: { active: false },
      },
    ];

    for (const record of cases) {
      const { service, prisma, passwords } = createHarness();
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);

      await expect(
        service.reset({ token: 'raw-token', newPassword: 'nova-senha-123' }),
      ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('prevents concurrent consumption when the token was already claimed', async () => {
    const { service, prisma, tx, passwords } = createHarness();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { active: true },
    });
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reset({ token: 'raw-token', newPassword: 'nova-senha-123' }),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    expect(passwords.hash).toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('looks up the token by its SHA-256 hash, never by the raw value', async () => {
    const { service, prisma } = createHarness();
    const token = randomUUID();
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(service.reset({ token, newPassword: 'nova-senha-123' })).rejects.toBeInstanceOf(
      InvalidPasswordResetTokenError,
    );

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { active: true } },
      },
    });
  });
});
