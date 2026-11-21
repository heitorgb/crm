import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { authHeaders, cleanupTenants, createTestApp, seedMember, seedTenant, type SeededTenant, type TestApp } from './crm.helpers.js';

describe('Per-member module access (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let owner: SeededTenant;
  let clerk: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => { await context.close(); });

  beforeEach(async () => {
    owner = await seedTenant(app, prisma, { name: 'Modules Owner' });
    clerk = await seedMember(app, prisma, owner.tenantId, { name: 'Modules Clerk', role: 'USER' });
  });

  afterEach(async () => { await cleanupTenants(prisma, [owner, clerk]); });

  function grant(moduleKeys: string[], actor: SeededTenant = owner) {
    return app.inject({ method: 'PATCH', url: `/api/members/${clerk.membershipId}`, headers: authHeaders(actor), payload: { moduleKeys } });
  }

  async function enabledFor(member: SeededTenant): Promise<string[]> {
    return (await app.inject({ method: 'GET', url: '/api/modules/enabled', headers: authHeaders(member) })).json().modules as string[];
  }

  it('limits menu modules and API access to the granted modules', async () => {
    const everything = await enabledFor(clerk);
    expect(everything).toEqual(expect.arrayContaining(['attendance', 'crm', 'deliveries']));

    const granted = await grant(['deliveries']);
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({ moduleKeys: ['deliveries'] });

    const limited = await enabledFor(clerk);
    expect(limited).toContain('deliveries');
    expect(limited).not.toContain('attendance');
    expect(limited).not.toContain('crm');

    expect((await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(clerk) })).statusCode).toBe(200);
    const blocked = await app.inject({ method: 'GET', url: '/api/conversations', headers: authHeaders(clerk) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('MODULE_FORBIDDEN');
    expect((await app.inject({ method: 'GET', url: '/api/tags', headers: authHeaders(clerk) })).statusCode).toBe(403);

    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: authHeaders(owner) })).statusCode).toBe(200);
    expect(await enabledFor(owner)).toEqual(everything);

    expect((await grant([])).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: authHeaders(clerk) })).statusCode).toBe(200);
  });

  it('only lets admins see grantable modules and change grants', async () => {
    const grantable = await app.inject({ method: 'GET', url: '/api/modules/grantable', headers: authHeaders(owner) });
    expect(grantable.statusCode).toBe(200);
    expect(grantable.json().map((module: { key: string }) => module.key)).toEqual(expect.arrayContaining(['attendance', 'deliveries']));

    expect((await app.inject({ method: 'GET', url: '/api/modules/grantable', headers: authHeaders(clerk) })).statusCode).toBe(403);
    expect((await grant(['deliveries'], clerk)).statusCode).toBe(403);
  });

  it('rejects modules that are not in the catalog', async () => {
    const response = await grant(['deliveries', 'nao-existe']);
    expect(response.statusCode).toBe(400);
    expect(await prisma.tenantUserModule.count({ where: { tenantUserId: clerk.membershipId } })).toBe(0);
  });
});
