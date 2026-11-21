import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { authHeaders, cleanupTenants, createTestApp, seedMember, seedTenant, type SeededTenant, type TestApp } from './crm.helpers.js';

describe('Store-restricted member access (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let owner: SeededTenant;
  let clerk: SeededTenant;
  let otherOwner: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => { await context.close(); });

  beforeEach(async () => {
    owner = await seedTenant(app, prisma, { name: 'Access Owner' });
    clerk = await seedMember(app, prisma, owner.tenantId, { name: 'Access Clerk', role: 'USER' });
    otherOwner = await seedTenant(app, prisma, { name: 'Access Other' });
  });

  afterEach(async () => { await cleanupTenants(prisma, [owner, clerk, otherOwner]); });

  async function seedStoreWithConversation(tenantId: string, label: string) {
    const instance = await prisma.whatsAppInstance.create({
      data: { tenantId, name: label, instanceName: `access-${randomUUID()}`, status: 'CONNECTED', active: true },
    });
    const store = await prisma.store.create({
      data: { tenantId, name: label, externalCode: randomUUID(), whatsappInstanceId: instance.id },
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId, whatsappInstanceId: instance.id, externalContactId: `55119${Date.now() % 100000000}@s.whatsapp.net` },
    });
    const order = await prisma.storeOrder.create({
      data: { tenantId, storeId: store.id, externalOrderId: randomUUID(), approvedAt: new Date(), customerName: label },
    });
    return { instance, store, conversation, order };
  }

  it('limits a linked member to the orders and conversations of their stores', async () => {
    const mine = await seedStoreWithConversation(owner.tenantId, 'Loja A');
    const theirs = await seedStoreWithConversation(owner.tenantId, 'Loja B');

    const linked = await app.inject({ method: 'PATCH', url: `/api/members/${clerk.membershipId}`,
      headers: authHeaders(owner), payload: { storeIds: [mine.store.id] } });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ storeIds: [mine.store.id] });

    const stores = await app.inject({ method: 'GET', url: '/api/store-orders/stores', headers: authHeaders(clerk) });
    expect(stores.json().map((store: { id: string }) => store.id)).toEqual([mine.store.id]);

    const orders = await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(clerk) });
    expect(orders.json().data.map((order: { id: string }) => order.id)).toEqual([mine.order.id]);
    expect((await app.inject({ method: 'GET', url: `/api/store-orders/${theirs.order.id}`, headers: authHeaders(clerk) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/store-orders/${theirs.order.id}/status`,
      headers: authHeaders(clerk), payload: { status: 'SEPARANDO' } })).statusCode).toBe(404);

    const conversations = await app.inject({ method: 'GET', url: '/api/conversations', headers: authHeaders(clerk) });
    expect(conversations.json().data.map((conversation: { id: string }) => conversation.id)).toEqual([mine.conversation.id]);
    expect((await app.inject({ method: 'GET', url: `/api/conversations/${mine.conversation.id}`, headers: authHeaders(clerk) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/conversations/${theirs.conversation.id}`, headers: authHeaders(clerk) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/conversations/${theirs.conversation.id}/messages`, headers: authHeaders(clerk) })).statusCode).toBe(404);

    const instances = await app.inject({ method: 'GET', url: '/api/whatsapp/instances', headers: authHeaders(clerk) });
    expect(instances.json().data.map((instance: { id: string }) => instance.id)).toEqual([mine.instance.id]);

    const ownerConversations = await app.inject({ method: 'GET', url: '/api/conversations', headers: authHeaders(owner) });
    expect(ownerConversations.json().data).toHaveLength(2);
  });

  it('keeps members without linked stores unrestricted and can lift the restriction', async () => {
    const mine = await seedStoreWithConversation(owner.tenantId, 'Loja A');
    await seedStoreWithConversation(owner.tenantId, 'Loja B');

    expect((await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(clerk) })).json().data).toHaveLength(2);

    await app.inject({ method: 'PATCH', url: `/api/members/${clerk.membershipId}`, headers: authHeaders(owner), payload: { storeIds: [mine.store.id] } });
    expect((await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(clerk) })).json().data).toHaveLength(1);

    await app.inject({ method: 'PATCH', url: `/api/members/${clerk.membershipId}`, headers: authHeaders(owner), payload: { storeIds: [] } });
    expect((await app.inject({ method: 'GET', url: '/api/store-orders', headers: authHeaders(clerk) })).json().data).toHaveLength(2);
  });

  it('rejects stores and WhatsApp instances from another tenant', async () => {
    const foreign = await seedStoreWithConversation(otherOwner.tenantId, 'Loja externa');

    const linkForeignStore = await app.inject({ method: 'PATCH', url: `/api/members/${clerk.membershipId}`,
      headers: authHeaders(owner), payload: { storeIds: [foreign.store.id] } });
    expect(linkForeignStore.statusCode).toBe(400);
    expect(await prisma.tenantUserStore.count({ where: { tenantUserId: clerk.membershipId } })).toBe(0);

    const createWithForeignInstance = await app.inject({ method: 'POST', url: '/api/store-orders/stores',
      headers: authHeaders(owner), payload: { name: 'Loja', externalCode: randomUUID(), whatsappInstanceId: foreign.instance.id } });
    expect(createWithForeignInstance.statusCode).toBe(404);
  });

  it('only lets admins change member stores', async () => {
    const mine = await seedStoreWithConversation(owner.tenantId, 'Loja A');
    const response = await app.inject({ method: 'PATCH', url: `/api/members/${clerk.membershipId}`,
      headers: authHeaders(clerk), payload: { storeIds: [mine.store.id] } });
    expect(response.statusCode).toBe(403);
  });
});
