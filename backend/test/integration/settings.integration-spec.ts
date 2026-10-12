import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/auth.constants.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  TEST_PASSWORD,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

describe('Profile and settings (integration)', () => {
  let harness: TestApp;
  let prisma: PrismaService;
  const seeded: SeededTenant[] = [];
  const suffix = randomUUID();

  beforeAll(async () => {
    harness = await createTestApp();
    prisma = harness.prisma;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    await cleanupTenants(prisma, seeded);
    await harness.close();
  });

  function login(email: string, tenantId?: string) {
    return harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: TEST_PASSWORD, ...(tenantId ? { tenantId } : {}) },
    });
  }

  function refreshCookie(response: { cookies: Array<{ name: string; value: string }> }) {
    return response.cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME);
  }

  describe('perfil', () => {
    it('updates the profile name', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'Profile' });
      seeded.push(tenant);

      const response = await harness.app.inject({
        method: 'PATCH',
        url: '/api/auth/me',
        headers: authHeaders(tenant),
        payload: { name: 'Nome Atualizado' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: tenant.userId, name: 'Nome Atualizado' });

      const me = await harness.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authHeaders(tenant),
      });
      expect(me.json().user.name).toBe('Nome Atualizado');
    });
  });

  describe('senha', () => {
    it('rejects a wrong current password', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'PwdWrong' });
      seeded.push(tenant);

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: authHeaders(tenant),
        payload: { currentPassword: 'errada-12345', newPassword: 'nova-senha-123' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('INVALID_CURRENT_PASSWORD');
    });

    it('changes the password and revokes the other sessions', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'PwdChange' });
      seeded.push(tenant);

      const secondLogin = await login(tenant.email, tenant.tenantId);
      const secondCookie = refreshCookie(secondLogin);
      const currentCookie = refreshCookie(await login(tenant.email, tenant.tenantId));
      expect(currentCookie).toBeDefined();

      const change = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: authHeaders(tenant),
        cookies: currentCookie ? { [REFRESH_COOKIE_NAME]: currentCookie.value } : {},
        payload: { currentPassword: TEST_PASSWORD, newPassword: 'nova-senha-123' },
      });
      expect(change.statusCode).toBe(204);

      const oldLogin = await login(tenant.email, tenant.tenantId);
      expect(oldLogin.statusCode).toBe(401);

      const newLogin = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: tenant.email, password: 'nova-senha-123', tenantId: tenant.tenantId },
      });
      expect(newLogin.statusCode).toBe(200);

      const reused = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: secondCookie ? { [REFRESH_COOKIE_NAME]: secondCookie.value } : {},
      });
      expect(reused.statusCode).toBe(401);
    });
  });

  describe('organização', () => {
    it('renames the current tenant for an owner', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'Org' });
      seeded.push(tenant);

      const renamed = await harness.app.inject({
        method: 'PATCH',
        url: '/api/tenants/current',
        headers: authHeaders(tenant),
        payload: { name: 'Renomeada' },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().name).toBe('Renomeada');

      const current = await harness.app.inject({
        method: 'GET',
        url: '/api/tenants/current',
        headers: authHeaders(tenant),
      });
      expect(current.json().name).toBe('Renomeada');
    });

    it('forbids a regular user from renaming the tenant', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'OrgUser' });
      seeded.push(tenant);
      const user = await seedMember(harness.app, prisma, tenant.tenantId, {
        name: 'Member',
        role: 'USER',
      });
      seeded.push(user);

      const response = await harness.app.inject({
        method: 'PATCH',
        url: '/api/tenants/current',
        headers: authHeaders(user),
        payload: { name: 'Nao Pode' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('equipe', () => {
    it('adds, updates and removes members', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'Team' });
      seeded.push(tenant);
      const email = `membro-${suffix}@example.com`;

      const created = await harness.app.inject({
        method: 'POST',
        url: '/api/members',
        headers: authHeaders(tenant),
        payload: { name: 'Membro', email, password: 'senha-membro-1', role: 'ADMIN' },
      });
      expect(created.statusCode).toBe(201);
      const memberId = created.json().id as string;
      expect(created.json()).toMatchObject({ email, role: 'ADMIN', active: true });

      const duplicate = await harness.app.inject({
        method: 'POST',
        url: '/api/members',
        headers: authHeaders(tenant),
        payload: { name: 'Membro', email, role: 'ADMIN' },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().code).toBe('MEMBERSHIP_ALREADY_EXISTS');

      const promoted = await harness.app.inject({
        method: 'PATCH',
        url: `/api/members/${memberId}`,
        headers: authHeaders(tenant),
        payload: { role: 'USER' },
      });
      expect(promoted.statusCode).toBe(200);
      expect(promoted.json().role).toBe('USER');

      const removed = await harness.app.inject({
        method: 'DELETE',
        url: `/api/members/${memberId}`,
        headers: authHeaders(tenant),
      });
      expect(removed.statusCode).toBe(204);
    });

    it('protects the last active owner', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'LastOwner' });
      seeded.push(tenant);

      const members = await harness.app.inject({
        method: 'GET',
        url: '/api/members',
        headers: authHeaders(tenant),
      });
      const owner = (members.json() as Array<{ id: string; role: string }>).find(
        (member) => member.role === 'OWNER',
      );

      const response = await harness.app.inject({
        method: 'PATCH',
        url: `/api/members/${owner?.id}`,
        headers: authHeaders(tenant),
        payload: { active: false },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('LAST_OWNER_REQUIRED');
    });

    it('forbids a regular user from managing members', async () => {
      const tenant = await seedTenant(harness.app, prisma, { name: 'TeamUser' });
      seeded.push(tenant);
      const user = await seedMember(harness.app, prisma, tenant.tenantId, {
        name: 'Member',
        role: 'USER',
      });
      seeded.push(user);

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/members',
        headers: authHeaders(user),
        payload: { name: 'X', email: `x-${suffix}@example.com`, role: 'USER' },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
