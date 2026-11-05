import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../src/infrastructure/realtime/realtime.service.js';
import { authHeaders, cleanupTenants, createTestApp, seedMember, seedTenant, type SeededTenant, type TestApp } from './crm.helpers.js';

describe('Store order approval (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let realtime: RealtimeService;
  let ownerA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
    realtime = app.get(RealtimeService);
  });

  afterAll(async () => { await context.close(); });

  beforeEach(async () => {
    ownerA = await seedTenant(app, prisma, { name: 'Orders A' });
    ownerB = await seedTenant(app, prisma, { name: 'Orders B' });
  });

  afterEach(async () => { await cleanupTenants(prisma, [ownerA, ownerB]); });

  async function createStore(owner: SeededTenant) {
    const response = await app.inject({
      method: 'POST', url: '/api/store-orders/stores', headers: authHeaders(owner),
      payload: { name: 'Loja teste', externalCode: randomUUID() },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; secret: string };
  }

  function approve(storeId: string, secret: string, externalOrderId = '123') {
    return app.inject({
      method: 'POST', url: `/api/store-orders/stores/${storeId}/approved`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { externalOrderId, approvedAt: '2026-11-05T12:00:00.000Z', customerName: 'Ana' },
    });
  }

  it('creates one pending-separation order and one history entry on repeated approval', async () => {
    const emitted = vi.spyOn(realtime, 'emitToTenant');
    const store = await createStore(ownerA);
    const first = await approve(store.id, store.secret);
    const replay = await approve(store.id, store.secret);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: true, status: 'PENDENTE_SEPARACAO' });
    expect(replay.json()).toMatchObject({ id: first.json().id, created: false });
    expect(await prisma.storeOrder.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    expect(await prisma.storeOrderStatusChange.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    expect(emitted).toHaveBeenCalledExactlyOnceWith(ownerA.tenantId, 'store-order.updated', { orderId: first.json().id });
    emitted.mockRestore();
  });

  it('rejects a foreign or invalid store credential', async () => {
    const a = await createStore(ownerA);
    const b = await createStore(ownerB);
    expect((await approve(a.id, b.secret)).statusCode).toBe(401);
    expect((await approve(a.id, 'wrong')).statusCode).toBe(401);
    expect(await prisma.storeOrder.count({ where: { tenantId: { in: [ownerA.tenantId, ownerB.tenantId] } } })).toBe(0);
  });

  it('allows the same external order ID in separate stores', async () => {
    const a = await createStore(ownerA);
    const b = await createStore(ownerB);
    expect((await approve(a.id, a.secret)).json().created).toBe(true);
    expect((await approve(b.id, b.secret)).json().created).toBe(true);
    expect(await prisma.storeOrder.count({ where: { tenantId: { in: [ownerA.tenantId, ownerB.tenantId] } } })).toBe(2);
  });

  it('blocks delivery operations for a disabled organization without affecting another', async () => {
    const a = await createStore(ownerA);
    const b = await createStore(ownerB);
    const module = await prisma.module.findUniqueOrThrow({ where: { key: 'deliveries' } });
    await prisma.tenantModule.create({ data: { tenantId: ownerA.tenantId, moduleId: module.id, enabled: false } });

    const listA = await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(ownerA) });
    expect(listA.statusCode).toBe(403);
    expect(listA.json()).toMatchObject({ code: 'MODULE_DISABLED' });
    const approvedA = await approve(a.id, a.secret);
    expect(approvedA.statusCode).toBe(403);
    expect(await prisma.storeOrder.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);

    expect((await approve(b.id, b.secret)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(ownerB) })).statusCode).toBe(200);
  });

  it('creates a manual order for a contact of the current tenant and moves its status', async () => {
    const store = await createStore(ownerA);
    const contact = await prisma.contact.create({
      data: { tenantId: ownerA.tenantId, name: 'Contato teste', phone: `55${Date.now()}` },
    });
    const created = await app.inject({
      method: 'POST', url: '/api/store-orders/manual', headers: authHeaders(ownerA),
      payload: { storeId: store.id, contactId: contact.id, orderText: 'Pedido recebido por telefone' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'PENDENTE_SEPARACAO', contactId: contact.id });
    expect(created.json().externalOrderId).toMatch(/^manual:/);

    const moved = await app.inject({
      method: 'PATCH', url: `/api/store-orders/${created.json().id}/status`,
      headers: authHeaders(ownerA), payload: { status: 'SEPARANDO' },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().status).toBe('SEPARANDO');
    expect(await prisma.storeOrderStatusChange.count({ where: { orderId: created.json().id } })).toBe(2);

    const foreign = await app.inject({
      method: 'PATCH', url: `/api/store-orders/${created.json().id}/status`,
      headers: authHeaders(ownerB), payload: { status: 'SEPARADO' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('rejects a contact belonging to another tenant for a manual order', async () => {
    const store = await createStore(ownerA);
    const foreignContact = await prisma.contact.create({
      data: { tenantId: ownerB.tenantId, name: 'Outro contato' },
    });
    const response = await app.inject({
      method: 'POST', url: '/api/store-orders/manual', headers: authHeaders(ownerA),
      payload: { storeId: store.id, contactId: foreignContact.id, orderText: 'Texto' },
    });
    expect(response.statusCode).toBe(404);
    expect(await prisma.storeOrder.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
  });

  it('manages only its own stores, changes delivery mode, and rotates the credential', async () => {
    const store = await createStore(ownerA);
    const foreign = await createStore(ownerB);
    const listed = await app.inject({ method: 'GET', url: '/api/store-orders/stores/manage', headers: authHeaders(ownerA) });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).not.toHaveProperty('secret');
    expect(listed.json()[0]).not.toHaveProperty('integrationSecretHash');

    const updated = await app.inject({ method: 'PATCH', url: `/api/store-orders/stores/${store.id}`,
      headers: authHeaders(ownerA), payload: { name: 'Loja A', deliveryConfirmationMode: 'MANUAL' } });
    expect(updated.json()).toMatchObject({ name: 'Loja A', deliveryConfirmationMode: 'MANUAL' });
    const foreignUpdate = await app.inject({ method: 'PATCH', url: `/api/store-orders/stores/${foreign.id}`,
      headers: authHeaders(ownerA), payload: { active: false } });
    expect(foreignUpdate.statusCode).toBe(404);

    const rotated = await app.inject({ method: 'POST', url: `/api/store-orders/stores/${store.id}/rotate-secret`,
      headers: authHeaders(ownerA) });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().secret).toMatch(/^whk_/);
    expect((await approve(store.id, store.secret)).statusCode).toBe(401);
    expect((await approve(store.id, rotated.json().secret)).statusCode).toBe(200);
  });

  it('prevents ordinary members from managing stores', async () => {
    const member = await seedMember(app, prisma, ownerA.tenantId, { name: 'Orders member' });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/store-orders/stores',
        headers: authHeaders(member), payload: { name: 'Teste', externalCode: randomUUID() } });
      expect(response.statusCode).toBe(403);
      const list = await app.inject({ method: 'GET', url: '/api/store-orders/stores/manage', headers: authHeaders(member) });
      expect(list.statusCode).toBe(403);
    } finally {
      await prisma.tenantUser.delete({ where: { id: member.membershipId } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });
});
