import { createHash, randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EmailDeliveryError } from '../../src/infrastructure/email/email.errors.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/auth.constants.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import {
  TEST_PASSWORD,
  cleanupTenants,
  createTestApp,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

const NEW_PASSWORD = 'nova-senha-segura-123';
const GENERIC_MESSAGE =
  'Se existir uma conta associada a esse e-mail, você receberá as instruções para redefinir sua senha.';

interface EmailCapture {
  token: string;
  to: string;
  name: string;
}

const passwords = new PasswordService();

describe('Password recovery (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let ownerB: SeededTenant;
  let inactive: SeededTenant;
  let emailService: {
    assertConfigured: ReturnType<typeof vi.fn>;
    sendPasswordResetEmail: ReturnType<typeof vi.fn>;
  };
  let sent: EmailCapture[];

  beforeAll(async () => {
    sent = [];
    emailService = {
      assertConfigured: vi.fn(),
      sendPasswordResetEmail: vi.fn(async (input: EmailCapture) => {
        sent.push(input);
      }),
    };
    context = await createTestApp({ emailService });
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    emailService.assertConfigured.mockReset();
    emailService.sendPasswordResetEmail.mockClear();
    emailService.sendPasswordResetEmail.mockImplementation(async (input: EmailCapture) => {
      sent.push(input);
    });

    const suffix = Date.now().toString(36);
    ownerA = await seedTenant(app, prisma, { name: `Reset Owner A ${suffix}`, role: 'OWNER' });
    ownerB = await seedTenant(app, prisma, { name: `Reset Owner B ${suffix}`, role: 'OWNER' });
    inactive = await seedTenant(app, prisma, { name: `Reset Inactive ${suffix}`, role: 'OWNER' });
    await prisma.user.update({ where: { id: inactive.userId }, data: { active: false } });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, ownerB, inactive]);
  });

  it('returns the same generic response for existing and unknown e-mails', async () => {
    const existing = await forgot(ownerA.email);
    const unknown = await forgot(`ghost-${randomUUID()}@example.com`);

    expect(existing.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(existing.json()).toEqual({ message: GENERIC_MESSAGE });
    expect(unknown.json()).toEqual(existing.json());
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sent[0]?.to).toBe(ownerA.email);
  });

  it('normalizes the address before lookup and never sends to inactive users', async () => {
    const response = await forgot(`  ${ownerA.email.toUpperCase()}  `);
    const inactiveResponse = await forgot(inactive.email);

    expect(response.statusCode).toBe(200);
    expect(inactiveResponse.statusCode).toBe(200);
    expect(inactiveResponse.json()).toEqual({ message: GENERIC_MESSAGE });
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sent[0]?.to).toBe(ownerA.email);
  });

  it('stores only the token hash, expires it in 30 minutes and invalidates previous requests', async () => {
    await forgot(ownerA.email);
    const firstToken = sent[0].token;
    const firstRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(firstToken) },
    });

    expect(firstRecord).not.toBeNull();
    expect(firstRecord?.tokenHash).not.toBe(firstToken);
    expect(firstRecord?.usedAt).toBeNull();
    const ttl = (firstRecord?.expiresAt.getTime() ?? 0) - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000);

    await forgot(ownerA.email);

    const records = await prisma.passwordResetToken.findMany({
      where: { userId: ownerA.userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(records).toHaveLength(2);
    expect(records.filter((record) => record.usedAt === null)).toHaveLength(1);
    expect(
      records.find((record) => record.tokenHash === hashToken(firstToken))?.usedAt,
    ).not.toBeNull();
  });

  it('does not reveal an unknown account when e-mail delivery is unavailable', async () => {
    emailService.sendPasswordResetEmail.mockRejectedValue(new EmailDeliveryError());

    const unknown = await forgot(`ghost-${randomUUID()}@example.com`);

    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ message: GENERIC_MESSAGE });

    const existing = await forgot(ownerA.email);

    expect(existing.statusCode).toBe(502);
    expect(existing.json().code).toBe('EMAIL_DELIVERY_FAILED');
    expect(existing.body).not.toContain(sent[0]?.token ?? 'no-token');
  });

  it('resets the password, rejects the old one, allows the new one and consumes the token', async () => {
    await forgot(ownerA.email);
    const token = sent[0].token;

    const response = await reset(token, NEW_PASSWORD);

    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME)).toBeUndefined();

    const oldLogin = await login(ownerA.email, TEST_PASSWORD);
    expect(oldLogin.statusCode).toBe(401);
    expect(oldLogin.json().code).toBe('INVALID_CREDENTIALS');

    const newLogin = await login(ownerA.email, NEW_PASSWORD);
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json().accessToken).toEqual(expect.any(String));

    const reuse = await reset(token, 'outra-senha-123');
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().code).toBe('INVALID_PASSWORD_RESET_TOKEN');

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    expect(record?.usedAt).not.toBeNull();
  });

  it('revokes existing refresh sessions after a successful reset', async () => {
    const session = await login(ownerA.email, TEST_PASSWORD);
    const cookie = session.cookies.find((item) => item.name === REFRESH_COOKIE_NAME);
    expect(cookie).toBeDefined();

    await forgot(ownerA.email);
    await reset(sent[0].token, NEW_PASSWORD);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: cookie ? { [REFRESH_COOKIE_NAME]: cookie.value } : {},
    });

    expect(refreshed.statusCode).toBe(401);
    expect(['INVALID_REFRESH_TOKEN', 'REFRESH_TOKEN_REUSE']).toContain(refreshed.json().code);
  });

  it('rejects invalid, expired and already-used tokens', async () => {
    const invalid = await reset('a'.repeat(43), NEW_PASSWORD);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('INVALID_PASSWORD_RESET_TOKEN');

    const expiredToken = `expired-${randomUUID()}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: ownerA.userId,
        tokenHash: hashToken(expiredToken),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await reset(expiredToken, NEW_PASSWORD);
    expect(expired.statusCode).toBe(400);

    const usedToken = `used-${randomUUID()}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: ownerA.userId,
        tokenHash: hashToken(usedToken),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });
    const used = await reset(usedToken, NEW_PASSWORD);
    expect(used.statusCode).toBe(400);
  });

  it('allows only one concurrent consumption of the same token', async () => {
    await forgot(ownerA.email);
    const token = sent[0].token;

    const responses = await Promise.all([
      reset(token, NEW_PASSWORD),
      reset(token, 'outra-senha-456'),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();

    expect(statuses).toEqual([204, 400]);
  });

  it('keeps tenants isolated: resetting one account does not affect another tenant user', async () => {
    const userBBefore = await prisma.user.findUniqueOrThrow({ where: { id: ownerB.userId } });

    await forgot(ownerA.email);
    await reset(sent[0].token, NEW_PASSWORD);

    const userBAfter = await prisma.user.findUniqueOrThrow({ where: { id: ownerB.userId } });
    expect(userBAfter.passwordHash).toBe(userBBefore.passwordHash);

    const loginB = await login(ownerB.email, TEST_PASSWORD);
    expect(loginB.statusCode).toBe(200);
    expect(loginB.json().tenant.id).toBe(ownerB.tenantId);

    const loginAWithNewPassword = await login(ownerA.email, NEW_PASSWORD);
    expect(loginAWithNewPassword.statusCode).toBe(200);
    expect(loginAWithNewPassword.json().tenant.id).toBe(ownerA.tenantId);
  });

  it('validates the payload without leaking internal details', async () => {
    const badEmail = await forgot('not-an-email');
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.body).not.toContain('password');

    await forgot(ownerA.email);
    const weakPassword = await reset(sent[0].token, 'short');
    expect(weakPassword.statusCode).toBe(400);

    const extraField = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: sent[0].token, newPassword: NEW_PASSWORD, tenantId: randomUUID() },
    });
    expect(extraField.statusCode).toBe(400);
  });

  it('keeps the normal login flow unchanged', async () => {
    const response = await login(ownerB.email, TEST_PASSWORD);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tokenType: 'Bearer',
      tenant: { id: ownerB.tenantId },
      role: 'OWNER',
    });
    expect(response.json()).not.toHaveProperty('refreshToken');
    expect(response.json()).not.toHaveProperty('passwordHash');
  });

  it('rejects tokens for users without an active account even if the hash matches', async () => {
    const token = `inactive-${randomUUID()}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: inactive.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await reset(token, NEW_PASSWORD);

    expect(response.statusCode).toBe(400);
    expect(
      await passwords.verify(
        (await prisma.user.findUniqueOrThrow({ where: { id: inactive.userId } })).passwordHash,
        TEST_PASSWORD,
      ),
    ).toBe(true);
  });

  function forgot(email: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email },
    });
  }

  function reset(token: string, newPassword: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, newPassword },
    });
  }

  function login(email: string, password: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email,
        password,
        tenantId: email === ownerA.email ? ownerA.tenantId : ownerB.tenantId,
      },
    });
  }
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
