import { createHash, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { createFastifyAdapter } from '../../src/common/http/create-fastify-adapter.js';
import { registerHttpPlugins } from '../../src/common/http/register-http-plugins.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/auth.constants.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';

interface Seeded {
  tenantA: { id: string };
  tenantB: { id: string };
  tenantC: { id: string };
  userA: { id: string; email: string };
  userB: { id: string; email: string };
  userInactive: { id: string; email: string };
  userNoMembership: { id: string; email: string };
  inactiveMembershipUser: { id: string; email: string };
}

const PASSWORD = 'correct-horse-battery';
const passwords = new PasswordService();

describe('Authentication (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let closeApp: () => Promise<void>;
  let data!: Seeded;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'integration-test-access-secret-0000';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await registerHttpPlugins(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService, { strict: false });
    closeApp = () => app.close();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    data = await seed(prisma);
  });

  afterEach(async () => {
    await cleanup(prisma, data);
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials and does not expose the refresh token in the body', async () => {
      const response = await login(data.userB.email, data.tenantB.id);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        tokenType: 'Bearer',
        tenant: { id: data.tenantB.id },
        role: 'OWNER',
      });
      expect(response.json().accessToken).toEqual(expect.any(String));
      expect(response.json()).not.toHaveProperty('refreshToken');
      expect(refreshCookie(response)?.value).toEqual(expect.any(String));
    });

    it('rejects a wrong password with a generic error', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: data.userB.email, password: 'wrong', tenantId: data.tenantB.id },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('INVALID_CREDENTIALS');
    });

    it('does not reveal whether an email exists', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: `ghost-${randomUUID()}@example.com`, password: PASSWORD },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects an inactive user', async () => {
      const response = await login(data.userInactive.email, data.tenantA.id);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('USER_INACTIVE');
    });

    it('rejects an inactive membership', async () => {
      const response = await login(data.inactiveMembershipUser.email, data.tenantA.id);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('TENANT_ACCESS_DENIED');
    });

    it('rejects a user with no membership', async () => {
      const response = await login(data.userNoMembership.email, undefined);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('NO_ACTIVE_MEMBERSHIP');
    });

    it('requires a tenant when the user belongs to several tenants', async () => {
      const withoutTenant = await login(data.userA.email, undefined);
      expect(withoutTenant.statusCode).toBe(400);
      expect(withoutTenant.json().code).toBe('TENANT_REQUIRED');

      const withTenant = await login(data.userA.email, data.tenantA.id);
      expect(withTenant.statusCode).toBe(200);
      expect(withTenant.json().tenant.id).toBe(data.tenantA.id);
    });

    it('rejects a tenant where the user has no membership', async () => {
      const response = await login(data.userB.email, data.tenantA.id);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('TENANT_ACCESS_DENIED');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the authenticated context', async () => {
      const { accessToken } = await loginAndGetAccess(data.userB.email, data.tenantB.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        user: { id: data.userB.id },
        tenant: { id: data.tenantB.id },
        role: 'OWNER',
      });
      expect(response.json()).not.toHaveProperty('passwordHash');
    });

    it('rejects a missing or invalid access token', async () => {
      const missing = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(missing.statusCode).toBe(401);
      expect(missing.json().code).toBe('INVALID_ACCESS_TOKEN');

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: 'Bearer not-a-token' },
      });
      expect(invalid.statusCode).toBe(401);
    });

    it('ignores a role tampered into the access token (membership is the source of truth)', async () => {
      const forged = await jwt.signAsync(
        {
          sub: data.userB.id,
          tenantId: data.tenantB.id,
          membershipId: randomUUID(),
          role: 'ADMIN',
        },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 900 },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${forged}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe('OWNER');
      expect(response.json().membershipId).toEqual(expect.any(String));
    });

    it('rejects an access token for a tenant without membership', async () => {
      const forged = await jwt.signAsync(
        { sub: data.userB.id, tenantId: data.tenantA.id, membershipId: randomUUID(), role: 'OWNER' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 900 },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${forged}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('TENANT_ACCESS_DENIED');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates a valid refresh token', async () => {
      const loginResponse = await login(data.userB.email, data.tenantB.id);
      const cookie = refreshCookie(loginResponse);

      const refreshed = await refresh(cookie);

      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().accessToken).toEqual(expect.any(String));
      expect(refreshCookie(refreshed)?.value).not.toBe(cookie?.value);
    });

    it('rejects an unknown refresh token', async () => {
      const response = await refresh({ name: REFRESH_COOKIE_NAME, value: 'unknown' });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('detects refresh token reuse', async () => {
      const loginResponse = await login(data.userB.email, data.tenantB.id);
      const cookie = refreshCookie(loginResponse);

      await refresh(cookie);
      const reuse = await refresh(cookie);

      expect(reuse.statusCode).toBe(401);
      expect(reuse.json().code).toBe('REFRESH_TOKEN_REUSE');
    });

    it('rejects an expired refresh token', async () => {
      const rawToken = randomUUID();
      await prisma.refreshToken.create({
        data: {
          userId: data.userB.id,
          tenantId: data.tenantB.id,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          familyId: randomUUID(),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const response = await refresh({ name: REFRESH_COOKIE_NAME, value: rawToken });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('REFRESH_TOKEN_EXPIRED');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the refresh token', async () => {
      const loginResponse = await login(data.userB.email, data.tenantB.id);
      const cookie = refreshCookie(loginResponse);

      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        cookies: cookie ? { [REFRESH_COOKIE_NAME]: cookie.value } : {},
      });
      expect(logout.statusCode).toBe(204);

      const afterLogout = await refresh(cookie);
      expect(afterLogout.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/switch-tenant', () => {
    it('switches to an authorized tenant', async () => {
      const { accessToken } = await loginAndGetAccess(data.userA.email, data.tenantA.id);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/switch-tenant',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { tenantId: data.tenantB.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().tenant.id).toBe(data.tenantB.id);
      expect(response.json().role).toBe('USER');
    });

    it('rejects switching to an unauthorized tenant', async () => {
      const { accessToken } = await loginAndGetAccess(data.userB.email, data.tenantB.id);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/switch-tenant',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { tenantId: data.tenantA.id },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('TENANT_ACCESS_DENIED');
    });

    it('rejects switching without authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/switch-tenant',
        payload: { tenantId: data.tenantB.id },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  function login(email: string, tenantId: string | undefined) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: PASSWORD, ...(tenantId ? { tenantId } : {}) },
    });
  }

  async function loginAndGetAccess(email: string, tenantId: string) {
    const response = await login(email, tenantId);
    return { accessToken: response.json().accessToken as string, response };
  }

  function refresh(cookie: { name: string; value: string } | undefined) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: cookie ? { [cookie.name]: cookie.value } : {},
    });
  }
});

function refreshCookie(response: { cookies: Array<{ name: string; value: string }> }) {
  return response.cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME);
}

async function seed(prisma: PrismaService): Promise<Seeded> {
  const suffix = randomUUID();
  const passwordHash = await passwords.hash(PASSWORD);

  const tenantA = await prisma.tenant.create({ data: { name: `Tenant A ${suffix}` } });
  const tenantB = await prisma.tenant.create({ data: { name: `Tenant B ${suffix}` } });
  const tenantC = await prisma.tenant.create({ data: { name: `Tenant C ${suffix}` } });

  const userA = await prisma.user.create({
    data: { email: `a-${suffix}@example.com`, name: 'User A', passwordHash },
  });
  const userB = await prisma.user.create({
    data: { email: `b-${suffix}@example.com`, name: 'User B', passwordHash },
  });
  const userInactive = await prisma.user.create({
    data: { email: `inactive-${suffix}@example.com`, name: 'Inactive', passwordHash, active: false },
  });
  const userNoMembership = await prisma.user.create({
    data: { email: `nomember-${suffix}@example.com`, name: 'No Membership', passwordHash },
  });
  const inactiveMembershipUser = await prisma.user.create({
    data: { email: `inactive-member-${suffix}@example.com`, name: 'Inactive Member', passwordHash },
  });

  await prisma.tenantUser.create({
    data: { tenantId: tenantA.id, userId: userA.id, role: 'OWNER', active: true },
  });
  await prisma.tenantUser.create({
    data: { tenantId: tenantB.id, userId: userA.id, role: 'USER', active: true },
  });
  await prisma.tenantUser.create({
    data: { tenantId: tenantB.id, userId: userB.id, role: 'OWNER', active: true },
  });
  await prisma.tenantUser.create({
    data: { tenantId: tenantA.id, userId: userInactive.id, role: 'OWNER', active: true },
  });
  await prisma.tenantUser.create({
    data: { tenantId: tenantA.id, userId: inactiveMembershipUser.id, role: 'USER', active: false },
  });

  return {
    tenantA,
    tenantB,
    tenantC,
    userA,
    userB,
    userInactive,
    userNoMembership,
    inactiveMembershipUser,
  };
}

async function cleanup(prisma: PrismaService, data: Seeded): Promise<void> {
  const userIds = [
    data.userA.id,
    data.userB.id,
    data.userInactive.id,
    data.userNoMembership.id,
    data.inactiveMembershipUser.id,
  ];

  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.tenantUser.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({
    where: { id: { in: [data.tenantA.id, data.tenantB.id, data.tenantC.id] } },
  });
}
