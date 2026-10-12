import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createFastifyAdapter } from '../../src/common/http/create-fastify-adapter.js';
import { registerHttpPlugins } from '../../src/common/http/register-http-plugins.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';

const PASSWORD = 'correct-horse-battery';
const passwords = new PasswordService();

describe('Admin provisioning (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let closeApp: () => Promise<void>;

  const suffix = randomUUID();
  const adminEmail = `platform-admin-${suffix}@example.com`;
  const memberEmail = `regular-${suffix}@example.com`;

  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  let previousAllowlist: string | undefined;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'integration-test-access-secret-0000';
    previousAllowlist = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = adminEmail;

    const { AppModule } = await import('../../src/app.module.js');
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
    closeApp = () => app.close();

    const passwordHash = await passwords.hash(PASSWORD);

    const adminTenant = await prisma.tenant.create({ data: { name: `Platform ${suffix}` } });
    const memberTenant = await prisma.tenant.create({ data: { name: `Regular ${suffix}` } });
    createdTenantIds.push(adminTenant.id, memberTenant.id);

    const admin = await prisma.user.create({
      data: { email: adminEmail, name: 'Platform Admin', passwordHash },
    });
    const member = await prisma.user.create({
      data: { email: memberEmail, name: 'Regular Owner', passwordHash },
    });
    createdUserIds.push(admin.id, member.id);

    await prisma.tenantUser.create({
      data: { tenantId: adminTenant.id, userId: admin.id, role: 'OWNER', active: true },
    });
    await prisma.tenantUser.create({
      data: { tenantId: memberTenant.id, userId: member.id, role: 'OWNER', active: true },
    });
  });

  afterAll(async () => {
    if (previousAllowlist === undefined) {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    } else {
      process.env.PLATFORM_ADMIN_EMAILS = previousAllowlist;
    }

    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.tenantUser.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdTenantIds.length > 0) {
      await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    }

    await closeApp();
  });

  it('lists tenants for a platform admin', async () => {
    const accessToken = await login(adminEmail);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/tenants?perPage=5',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().data)).toBe(true);
  });

  it('blocks non platform admins', async () => {
    const accessToken = await login(memberEmail);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/tenants',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/tenants' });
    expect(response.statusCode).toBe(401);
  });

  it('creates a tenant with an owner that can log in', async () => {
    const accessToken = await login(adminEmail);
    const ownerEmail = `Owner-${suffix}@example.com`;

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        name: `Provisioned ${suffix}`,
        ownerName: 'Provisioned Owner',
        ownerEmail,
        ownerPassword: 'owner-password-123',
      },
    });

    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.id).toEqual(expect.any(String));
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({
      email: ownerEmail.toLowerCase(),
      role: 'OWNER',
      active: true,
    });

    createdTenantIds.push(body.id);
    const owner = await prisma.user.findUnique({ where: { email: ownerEmail.toLowerCase() } });
    if (owner) {
      createdUserIds.push(owner.id);
    }

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ownerEmail.toLowerCase(), password: 'owner-password-123' },
    });
    expect(ownerLogin.statusCode).toBe(200);
    expect(ownerLogin.json().tenant.id).toBe(body.id);
  });

  it('adds a member and rejects duplicates', async () => {
    const accessToken = await login(adminEmail);
    const tenantId = await createTenant(accessToken);
    const newEmail = `member-${suffix}@example.com`;

    const added = await app.inject({
      method: 'POST',
      url: `/api/admin/tenants/${tenantId}/members`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'Member', email: newEmail, password: 'member-password-1', role: 'ADMIN' },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().members).toHaveLength(2);

    const member = await prisma.user.findUnique({ where: { email: newEmail } });
    if (member) {
      createdUserIds.push(member.id);
    }

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/admin/tenants/${tenantId}/members`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'Member', email: newEmail, role: 'ADMIN' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('MEMBERSHIP_ALREADY_EXISTS');
  });

  it('protects the last active owner from being deactivated', async () => {
    const accessToken = await login(adminEmail);
    const tenantId = await createTenant(accessToken);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const owner = detail.json().members.find((m: { role: string }) => m.role === 'OWNER');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantId}/members/${owner.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { active: false },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('LAST_OWNER_REQUIRED');
  });

  async function createTenant(accessToken: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        name: `Provisioned ${randomUUID()}`,
        ownerName: 'Owner',
        ownerEmail: `owner-${randomUUID()}@example.com`,
        ownerPassword: 'owner-password-123',
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    createdTenantIds.push(body.id);
    const owner = await prisma.user.findUnique({ where: { email: body.members[0].email } });
    if (owner) {
      createdUserIds.push(owner.id);
    }
    return body.id as string;
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return response.json().accessToken as string;
  }
});
