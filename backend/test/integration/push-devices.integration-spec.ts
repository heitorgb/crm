import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

describe('Push devices (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    ownerA = await seedTenant(app, prisma, { name: 'Push Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Push User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Push Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  function register(tenant: SeededTenant, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/push-devices',
      headers: authHeaders(tenant),
      payload,
    });
  }

  function unregister(tenant: SeededTenant, token: string) {
    return app.inject({
      method: 'DELETE',
      url: '/api/push-devices',
      headers: authHeaders(tenant),
      payload: { token },
    });
  }

  it('registers a device for the current membership derived from the token', async () => {
    const spoofed = await register(userA, {
      token: 'fcm-token-a',
      platform: 'android',
      tenantId: ownerB.tenantId,
    });
    expect(spoofed.statusCode).toBe(400);

    const response = await register(userA, { token: 'fcm-token-a', platform: 'android' });

    expect(response.statusCode).toBe(204);
    const device = await prisma.pushDevice.findUniqueOrThrow({ where: { token: 'fcm-token-a' } });
    expect(device).toMatchObject({
      tenantId: ownerA.tenantId,
      tenantUserId: userA.membershipId,
      platform: 'ANDROID',
    });
  });

  it('moves a re-registered token to the membership that signed in last', async () => {
    await register(ownerA, { token: 'shared-phone', platform: 'android' });
    await register(ownerB, { token: 'shared-phone', platform: 'android' });

    const devices = await prisma.pushDevice.findMany({ where: { token: 'shared-phone' } });
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      tenantId: ownerB.tenantId,
      tenantUserId: ownerB.membershipId,
    });
  });

  it('only lets the owning membership unregister a device', async () => {
    await register(userA, { token: 'fcm-token-a', platform: 'android' });

    expect((await unregister(ownerB, 'fcm-token-a')).statusCode).toBe(204);
    expect((await unregister(ownerA, 'fcm-token-a')).statusCode).toBe(204);
    expect(await prisma.pushDevice.count({ where: { token: 'fcm-token-a' } })).toBe(1);

    expect((await unregister(userA, 'fcm-token-a')).statusCode).toBe(204);
    expect(await prisma.pushDevice.count({ where: { token: 'fcm-token-a' } })).toBe(0);
  });

  it('validates the payload and requires authentication', async () => {
    expect((await register(userA, { token: 'x', platform: 'ios' })).statusCode).toBe(400);
    expect((await register(userA, { token: 'with space', platform: 'android' })).statusCode).toBe(
      400,
    );

    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/push-devices',
      payload: { token: 'fcm-token-a', platform: 'android' },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
