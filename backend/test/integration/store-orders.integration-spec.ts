import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../src/infrastructure/realtime/realtime.service.js';
import { StoreOrderDeliverySchedulerService } from '../../src/modules/store-orders/store-order-delivery-scheduler.service.js';
import { authHeaders, cleanupTenants, createTestApp, seedMember, seedTenant, type SeededTenant, type TestApp } from './crm.helpers.js';

describe('Store order approval (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let realtime: RealtimeService;
  let deliveryScheduler: StoreOrderDeliverySchedulerService;
  let ownerA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
    realtime = app.get(RealtimeService);
    deliveryScheduler = app.get(StoreOrderDeliverySchedulerService);
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

  it('stores item and total snapshots, scopes detail access, and enriches an older approval', async () => {
    const store = await createStore(ownerA);
    const first = await approve(store.id, store.secret, 'items-123');
    const orderId = first.json().id as string;
    const items = [{ productCode: '42', description: 'Peça azul', quantity: '2.0000', unitPrice: '25.5000', lineTotal: '51.0000' }];
    const replay = await app.inject({ method: 'POST', url: `/api/store-orders/stores/${store.id}/approved`,
      headers: { authorization: `Bearer ${store.secret}` },
      payload: { externalOrderId: 'items-123', approvedAt: '2026-11-05T12:00:00.000Z', items, totalAmount: '51.0000' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ id: orderId, created: false, status: 'PENDENTE_SEPARACAO' });
    const detail = await app.inject({ method: 'GET', url: `/api/store-orders/${orderId}`, headers: authHeaders(ownerA) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ items, totalAmount: '51', storeId: store.id });
    expect((await app.inject({ method: 'GET', url: `/api/store-orders/${orderId}`, headers: authHeaders(ownerB) })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(ownerA) });
    expect(list.json().data[0]).not.toHaveProperty('items');
    expect(await prisma.storeOrderStatusChange.count({ where: { orderId } })).toBe(1);

    const next = await app.inject({ method: 'POST', url: `/api/store-orders/stores/${store.id}/approved`,
      headers: { authorization: `Bearer ${store.secret}` },
      payload: { externalOrderId: 'items-124', approvedAt: '2026-11-05T12:00:00.000Z', items, totalAmount: '51.0000' },
    });
    expect(next.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/store-orders/${next.json().id}`,
      headers: authHeaders(ownerA) })).json()).toMatchObject({ items, totalAmount: '51' });
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

  it('reuses a manual order when saving with the same request ID is retried', async () => {
    const store = await createStore(ownerA);
    const contact = await prisma.contact.create({
      data: { tenantId: ownerA.tenantId, name: 'Contato teste' },
    });
    const payload = { requestId: randomUUID(), storeId: store.id, contactId: contact.id, orderText: 'Pedido manual' };
    const send = () => app.inject({ method: 'POST', url: '/api/store-orders/manual', headers: authHeaders(ownerA), payload });
    const first = await send();
    const retry = await send();
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(first.json().id);
    expect(await prisma.storeOrder.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    expect(await prisma.storeOrderStatusChange.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
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

  it('shares card visibility within one organization and restricts changes to administrators', async () => {
    const member = await seedMember(app, prisma, ownerA.tenantId, { name: 'Cards member' });
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/store-orders/cards', headers: authHeaders(ownerA) });
      expect(initial.statusCode).toBe(200);
      expect(initial.json().statuses).toHaveLength(6);

      const changed = await app.inject({ method: 'PATCH', url: '/api/store-orders/cards',
        headers: authHeaders(ownerA), payload: { statuses: ['PENDENTE_SEPARACAO', 'EM_ROTA'] } });
      expect(changed.statusCode).toBe(200);
      expect(changed.json()).toEqual({ statuses: ['PENDENTE_SEPARACAO', 'EM_ROTA'] });
      const memberView = await app.inject({ method: 'GET', url: '/api/store-orders/cards', headers: authHeaders(member) });
      expect(memberView.json()).toEqual(changed.json());
      const otherTenant = await app.inject({ method: 'GET', url: '/api/store-orders/cards', headers: authHeaders(ownerB) });
      expect(otherTenant.json().statuses).toHaveLength(6);
      expect((await app.inject({ method: 'PATCH', url: '/api/store-orders/cards',
        headers: authHeaders(member), payload: { statuses: [] } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url: '/api/store-orders/cards',
        headers: authHeaders(ownerA), payload: { statuses: ['EM_ROTA', 'EM_ROTA'] } })).statusCode).toBe(400);
    } finally {
      await prisma.tenantUser.delete({ where: { id: member.membershipId } });
      await prisma.user.delete({ where: { id: member.userId } });
    }
  });

  it('uploads and removes a store logo without exposing it to another tenant', async () => {
    const store = await createStore(ownerA);
    const boundary = `----orderup${randomUUID()}`;
    const image = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2563eb' } }).png().toBuffer();
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const url = `/api/store-orders/stores/${store.id}/logo`;
    const uploaded = await app.inject({ method: 'POST', url,
      headers: { ...authHeaders(ownerA), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().logoUpdatedAt).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/api/store-orders/stores', headers: authHeaders(ownerA) })).json()[0].logoUpdatedAt).toBeTruthy();

    const owned = await app.inject({ method: 'GET', url, headers: authHeaders(ownerA) });
    expect(owned.statusCode).toBe(200);
    expect(owned.headers['content-type']).toContain('image/jpeg');
    expect((await app.inject({ method: 'GET', url, headers: authHeaders(ownerB) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url, headers: authHeaders(ownerA) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url, headers: authHeaders(ownerA) })).statusCode).toBe(404);
  });

  it('confirms only due automatic deliveries once and records their origin', async () => {
    const store = await createStore(ownerA);
    const approved = await approve(store.id, store.secret);
    const orderId = approved.json().id as string;
    for (const status of ['SEPARANDO', 'SEPARADO', 'EM_ROTA']) {
      const moved = await app.inject({ method: 'PATCH', url: `/api/store-orders/${orderId}/status`,
        headers: authHeaders(ownerA), payload: { status } });
      expect(moved.statusCode).toBe(200);
    }
    const inRoute = await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(inRoute.deliveryConfirmationMode).toBe('AUTOMATIC');
    expect(inRoute.deliveryDueAt?.getTime()).toBe(inRoute.enteredRouteAt!.getTime() + 2 * 60 * 60 * 1000);
    expect((await app.inject({ method: 'PATCH', url: `/api/store-orders/stores/${store.id}`,
      headers: authHeaders(ownerA), payload: { deliveryConfirmationMode: 'MANUAL' } })).statusCode).toBe(200);

    await deliveryScheduler.scan(new Date(inRoute.deliveryDueAt!.getTime() - 1));
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('EM_ROTA');
    const due = new Date(inRoute.deliveryDueAt!.getTime() + 1);
    await deliveryScheduler.scan(due);
    await deliveryScheduler.scan(due);
    const delivered = await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(delivered).toMatchObject({ status: 'ENTREGUE', deliveryConfirmationSource: 'AUTOMATIC', deliveryDueAt: null });
    expect(delivered.deliveredAt).toEqual(due);
    const history = await prisma.storeOrderStatusChange.findMany({ where: { tenantId: ownerA.tenantId, orderId, origin: 'AUTO_DELIVERY' } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ previousStatus: 'EM_ROTA', status: 'ENTREGUE', actorMembershipId: null });
  });

  it('keeps manual and interrupted deliveries out of automatic confirmation', async () => {
    const store = await createStore(ownerA);
    const first = await approve(store.id, store.secret, 'manual-mode');
    const manualId = first.json().id as string;
    await app.inject({ method: 'PATCH', url: `/api/store-orders/stores/${store.id}`,
      headers: authHeaders(ownerA), payload: { deliveryConfirmationMode: 'MANUAL' } });
    for (const status of ['SEPARANDO', 'SEPARADO', 'EM_ROTA']) {
      expect((await app.inject({ method: 'PATCH', url: `/api/store-orders/${manualId}/status`,
        headers: authHeaders(ownerA), payload: { status } })).statusCode).toBe(200);
    }
    const manual = await prisma.storeOrder.findUniqueOrThrow({ where: { id: manualId } });
    expect(manual).toMatchObject({ deliveryConfirmationMode: 'MANUAL', deliveryDueAt: null });

    await app.inject({ method: 'PATCH', url: `/api/store-orders/stores/${store.id}`,
      headers: authHeaders(ownerA), payload: { deliveryConfirmationMode: 'AUTOMATIC' } });
    const second = await approve(store.id, store.secret, 'interrupted');
    const interruptedId = second.json().id as string;
    for (const status of ['SEPARANDO', 'SEPARADO', 'EM_ROTA', 'OBSERVACAO']) {
      expect((await app.inject({ method: 'PATCH', url: `/api/store-orders/${interruptedId}/status`,
        headers: authHeaders(ownerA), payload: { status } })).statusCode).toBe(200);
    }
    await deliveryScheduler.scan(new Date(Date.now() + 3 * 60 * 60 * 1000));
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: manualId } })).status).toBe('EM_ROTA');
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: interruptedId } })).status).toBe('OBSERVACAO');
    expect(await prisma.storeOrderStatusChange.count({ where: { tenantId: ownerA.tenantId, origin: 'AUTO_DELIVERY' } })).toBe(0);
  });

  it('does not auto-confirm deliveries while the organization module is disabled', async () => {
    const store = await createStore(ownerA);
    const approved = await approve(store.id, store.secret);
    const orderId = approved.json().id as string;
    for (const status of ['SEPARANDO', 'SEPARADO', 'EM_ROTA']) {
      expect((await app.inject({ method: 'PATCH', url: `/api/store-orders/${orderId}/status`,
        headers: authHeaders(ownerA), payload: { status } })).statusCode).toBe(200);
    }
    const dueAt = (await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } })).deliveryDueAt!;
    const module = await prisma.module.findUniqueOrThrow({ where: { key: 'deliveries' } });
    await prisma.tenantModule.create({ data: { tenantId: ownerA.tenantId, moduleId: module.id, enabled: false } });
    await deliveryScheduler.scan(new Date(dueAt.getTime() + 1));
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('EM_ROTA');
    await prisma.tenantModule.update({ where: { tenantId_moduleId: { tenantId: ownerA.tenantId, moduleId: module.id } },
      data: { enabled: true } });
    await deliveryScheduler.scan(new Date(dueAt.getTime() + 1));
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('ENTREGUE');
  });
});
