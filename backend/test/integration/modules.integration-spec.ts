import { randomUUID } from 'node:crypto';
import { PLATFORM_ADMIN_EMAIL } from './modules.env.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { BillingRemindersService } from '../../src/modules/billing/billing-reminders.service.js';
import { localDateString, parseDateOnly } from '../../src/modules/billing/billing-time.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedTenant,
  TEST_PASSWORD,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

const TIMEZONE = 'America/Sao_Paulo';
const today = (): string => localDateString(new Date(), TIMEZONE);
const passwords = new PasswordService();

const suffix = randomUUID();
const adminEmail = PLATFORM_ADMIN_EMAIL;

describe('Modules management (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reminders: BillingRemindersService;

  let platformAdminTenantId: string;
  let platformAdminUserId: string;
  let platformAdminToken: string;

  let orgA: SeededTenant;
  let orgB: SeededTenant;

  const extraUserIds: string[] = [];

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: TEST_PASSWORD },
    });
    return response.json().accessToken as string;
  }

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
    reminders = app.get(BillingRemindersService);

    const passwordHash = await passwords.hash(TEST_PASSWORD);

    const leftover = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (leftover) {
      await prisma.user.delete({ where: { id: leftover.id } });
    }

    const adminTenant = await prisma.tenant.create({
      data: { name: `Platform Admin Org ${suffix}` },
    });
    platformAdminTenantId = adminTenant.id;

    const adminUser = await prisma.user.create({
      data: { email: adminEmail, name: 'Platform Admin', passwordHash },
    });
    platformAdminUserId = adminUser.id;
    extraUserIds.push(adminUser.id);

    await prisma.tenantUser.create({
      data: { tenantId: adminTenant.id, userId: adminUser.id, role: 'OWNER', active: true },
    });

    platformAdminToken = await login(adminEmail);
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { tenantId: platformAdminTenantId },
    });
    await prisma.tenant.deleteMany({ where: { id: platformAdminTenantId } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });

    await context.close();
  });

  beforeEach(async () => {
    orgA = await seedTenant(app, prisma, { name: 'Modules Org A', role: 'OWNER' });
    orgB = await seedTenant(app, prisma, { name: 'Modules Org B', role: 'OWNER' });
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { tenantId: { in: [orgA.tenantId, orgB.tenantId] } },
    });
    await cleanupTenants(prisma, [orgA, orgB]);
  });

  function getTenantModules(tenantId: string, token = platformAdminToken) {
    return app.inject({
      method: 'GET',
      url: `/api/admin/tenants/${tenantId}/modules`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  function setModule(tenantId: string, key: string, enabled: boolean, token = platformAdminToken) {
    return app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantId}/modules/${key}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled },
    });
  }

  function getEnabledModules(tenant: SeededTenant) {
    return app.inject({
      method: 'GET',
      url: '/api/modules/enabled',
      headers: authHeaders(tenant),
    });
  }

  it('lets the platform admin list every module and its state', async () => {
    const response = await getTenantModules(orgA.tenantId);

    expect(response.statusCode).toBe(200);
    const keys = (response.json() as { key: string; enabled: boolean }[]).map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'attendance',
        'contacts',
        'billing.charges',
        'billing.collection',
        'webhooks',
      ]),
    );
    expect((response.json() as { enabled: boolean }[]).every((m) => m.enabled)).toBe(true);
  });

  it('rejects a regular organization owner trying to read or change modules', async () => {
    const list = await getTenantModules(orgA.tenantId, orgA.accessToken);
    expect(list.statusCode).toBe(403);
    expect(list.json().code).toBe('PLATFORM_ADMIN_REQUIRED');

    const change = await setModule(orgA.tenantId, 'billing.collection', false, orgA.accessToken);
    expect(change.statusCode).toBe(403);
    expect(change.json().code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  it('requires authentication to manage modules', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/tenants/${orgA.tenantId}/modules`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('disables a module for one organization without affecting another', async () => {
    const disable = await setModule(orgA.tenantId, 'billing.collection', false);
    expect(disable.statusCode).toBe(200);
    expect(disable.json()).toMatchObject({ key: 'billing.collection', enabled: false });

    const stateA = await getTenantModules(orgA.tenantId);
    const collectionA = (stateA.json() as { key: string; enabled: boolean }[]).find(
      (m) => m.key === 'billing.collection',
    );
    expect(collectionA?.enabled).toBe(false);

    const stateB = await getTenantModules(orgB.tenantId);
    const collectionB = (stateB.json() as { key: string; enabled: boolean }[]).find(
      (m) => m.key === 'billing.collection',
    );
    expect(collectionB?.enabled).toBe(true);
  });

  it('blocks requests to a disabled module with MODULE_DISABLED and keeps other modules working', async () => {
    await setModule(orgB.tenantId, 'billing.collection', false);

    const settingsB = await app.inject({
      method: 'GET',
      url: '/api/billing/settings',
      headers: authHeaders(orgB),
    });
    expect(settingsB.statusCode).toBe(403);
    expect(settingsB.json().code).toBe('MODULE_DISABLED');
    expect(settingsB.json().details).toMatchObject({ module: 'billing.collection' });

    const chargesB = await app.inject({
      method: 'GET',
      url: '/api/billing/charges',
      headers: authHeaders(orgB),
    });
    expect(chargesB.statusCode).toBe(200);

    const settingsA = await app.inject({
      method: 'GET',
      url: '/api/billing/settings',
      headers: authHeaders(orgA),
    });
    expect(settingsA.statusCode).toBe(200);
  });

  it('blocks a disabled module through a direct API route (not only the menu)', async () => {
    await setModule(orgB.tenantId, 'attendance', false);

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: authHeaders(orgB),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('MODULE_DISABLED');

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: authHeaders(orgA),
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('exposes the enabled modules for the authenticated organization', async () => {
    await setModule(orgA.tenantId, 'contacts', false);

    const enabledA = await getEnabledModules(orgA);
    expect(enabledA.statusCode).toBe(200);
    expect(enabledA.json().modules).not.toContain('contacts');
    expect(enabledA.json().modules).toEqual(
      expect.arrayContaining(['attendance', 'billing.charges', 'billing.collection', 'webhooks']),
    );

    const enabledB = await getEnabledModules(orgB);
    expect(enabledB.json().modules).toContain('contacts');
  });

  it('keeps the previous behavior for organizations without explicit configuration', async () => {
    const enabled = await getEnabledModules(orgB);
    expect(enabled.json().modules).toEqual(
      expect.arrayContaining([
        'attendance',
        'contacts',
        'billing.charges',
        'billing.collection',
        'webhooks',
      ]),
    );

    const settings = await app.inject({
      method: 'GET',
      url: '/api/billing/settings',
      headers: authHeaders(orgB),
    });
    expect(settings.statusCode).toBe(200);
  });

  it('restores normal access when the module is re-enabled', async () => {
    await setModule(orgA.tenantId, 'billing.collection', false);

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/billing/settings',
      headers: authHeaders(orgA),
    });
    expect(blocked.statusCode).toBe(403);

    await setModule(orgA.tenantId, 'billing.collection', true);

    const restored = await app.inject({
      method: 'GET',
      url: '/api/billing/settings',
      headers: authHeaders(orgA),
    });
    expect(restored.statusCode).toBe(200);
  });

  it('preserves existing business data across disable and re-enable', async () => {
    const update = await app.inject({
      method: 'PATCH',
      url: '/api/billing/settings',
      headers: authHeaders(orgA),
      payload: { messageTemplate: 'Template customizado {cliente}' },
    });
    expect(update.statusCode).toBe(200);

    await setModule(orgA.tenantId, 'billing.collection', false);
    await setModule(orgA.tenantId, 'billing.collection', true);

    const settings = await app.inject({
      method: 'GET',
      url: '/api/billing/settings',
      headers: authHeaders(orgA),
    });
    expect(settings.json().messageTemplate).toBe('Template customizado {cliente}');
  });

  it('records an audit entry for each administrative change', async () => {
    await setModule(orgA.tenantId, 'billing.collection', false);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { tenantId: orgA.tenantId, entityId: 'billing.collection' },
      orderBy: { createdAt: 'desc' },
    });

    expect(audit).not.toBeNull();
    expect(audit?.action).toBe('MODULE_DISABLED');
    expect(audit?.actorUserId).toBe(platformAdminUserId);
  });

  it('does not run automatic reminders for an organization with the module disabled', async () => {
    const charge = await prisma.billingCharge.create({
      data: {
        tenantId: orgA.tenantId,
        description: 'Cobrança ativa',
        amountCents: 1000,
        dueDate: parseDateOnly(today()),
      },
      select: { id: true },
    });

    await reminders.generateReminders(today());
    const created = await prisma.billingReminder.count({
      where: { tenantId: orgA.tenantId, chargeId: charge.id },
    });
    expect(created).toBeGreaterThan(0);

    await setModule(orgA.tenantId, 'billing.collection', false);

    const blockedCharge = await prisma.billingCharge.create({
      data: {
        tenantId: orgA.tenantId,
        description: 'Cobrança bloqueada',
        amountCents: 2000,
        dueDate: parseDateOnly(today()),
      },
      select: { id: true },
    });

    await reminders.generateReminders(today());

    const blockedReminders = await prisma.billingReminder.count({
      where: { tenantId: orgA.tenantId, chargeId: blockedCharge.id },
    });
    expect(blockedReminders).toBe(0);
  });

  it('does not send a queued reminder when the module is disabled', async () => {
    const charge = await prisma.billingCharge.create({
      data: {
        tenantId: orgA.tenantId,
        description: 'Cobrança com lembrete',
        amountCents: 1000,
        dueDate: parseDateOnly(today()),
      },
      select: { id: true },
    });
    const reminder = await prisma.billingReminder.create({
      data: {
        tenantId: orgA.tenantId,
        chargeId: charge.id,
        offsetDays: 0,
        origin: 'AUTOMATIC',
        dedupeKey: `auto:0:${randomUUID()}`,
        scheduledFor: parseDateOnly(today()),
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
      select: { id: true },
    });

    await setModule(orgA.tenantId, 'billing.collection', false);
    await reminders.processReminder({ tenantId: orgA.tenantId, reminderId: reminder.id });

    const stored = await prisma.billingReminder.findUnique({ where: { id: reminder.id } });
    expect(stored?.status).toBe('PENDING');
  });
});
