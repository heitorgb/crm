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

describe('Contacts (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;
  let customerA: string;
  let customerB: string;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    ownerA = await seedTenant(app, prisma, { name: 'Contact Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Contact User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Contact Owner B', role: 'OWNER' });

    const createdA = await prisma.customer.create({
      data: { tenantId: ownerA.tenantId, name: 'Customer A' },
    });
    const createdB = await prisma.customer.create({
      data: { tenantId: ownerB.tenantId, name: 'Customer B' },
    });
    customerA = createdA.id;
    customerB = createdB.id;
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  function createContact(tenant: SeededTenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  describe('CRUD', () => {
    it('creates, reads, updates and deletes a contact', async () => {
      const created = await createContact(ownerA, {
        customerId: customerA,
        name: 'Maria Silva',
        email: 'MARIA@Example.com',
        phone: '+55 11 99999-0000',
        position: 'Diretora',
        isPrimary: true,
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        customerId: customerA,
        customerName: 'Customer A',
        name: 'Maria Silva',
        email: 'maria@example.com',
        isPrimary: true,
      });
      expect(created.json()).not.toHaveProperty('tenantId');

      const id = created.json().id as string;

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        headers: authHeaders(ownerA),
        payload: { position: 'CEO', email: null },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ position: 'CEO', email: null });

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(removed.statusCode).toBe(204);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(404);
    });

    it('rejects delete by a USER role', async () => {
      const created = await createContact(ownerA, { customerId: customerA, name: 'Contato' });
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${created.json().id}`,
        headers: authHeaders(userA),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('validation', () => {
    it('requires a valid customer and name', async () => {
      const missingCustomer = await createContact(ownerA, { name: 'Sem cliente' });
      expect(missingCustomer.statusCode).toBe(400);

      const missingName = await createContact(ownerA, { customerId: customerA });
      expect(missingName.statusCode).toBe(400);

      const invalidEmail = await createContact(ownerA, {
        customerId: customerA,
        name: 'Email inválido',
        email: 'not-an-email',
      });
      expect(invalidEmail.statusCode).toBe(400);
    });

    it('rejects a nonexistent customer', async () => {
      const response = await createContact(ownerA, {
        customerId: '00000000-0000-4000-8000-000000000000',
        name: 'Órfão',
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('CONTACT_CUSTOMER_NOT_FOUND');
    });
  });

  describe('pagination, search and filters', () => {
    it('paginates and searches contacts', async () => {
      await createContact(ownerA, { customerId: customerA, name: 'Ana', email: 'ana@example.com' });
      await createContact(ownerA, { customerId: customerA, name: 'Bruno', email: 'bruno@example.com' });
      await createContact(ownerA, { customerId: customerA, name: 'Carla', email: 'carla@example.com' });

      const page = await app.inject({
        method: 'GET',
        url: '/api/contacts?perPage=2&page=1&sort=name&order=asc',
        headers: authHeaders(ownerA),
      });
      expect(page.json().data.map((item: { name: string }) => item.name)).toEqual(['Ana', 'Bruno']);
      expect(page.json().meta.total).toBe(3);

      const search = await app.inject({
        method: 'GET',
        url: '/api/contacts?search=carla',
        headers: authHeaders(ownerA),
      });
      expect(search.json().data).toHaveLength(1);
      expect(search.json().data[0].name).toBe('Carla');
    });

    it('filters contacts by customer', async () => {
      const otherCustomer = await prisma.customer.create({
        data: { tenantId: ownerA.tenantId, name: 'Other Customer' },
      });
      await createContact(ownerA, { customerId: customerA, name: 'Do cliente A' });
      await createContact(ownerA, { customerId: otherCustomer.id, name: 'Do outro cliente' });

      const response = await app.inject({
        method: 'GET',
        url: `/api/contacts?customerId=${customerA}`,
        headers: authHeaders(ownerA),
      });
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].name).toBe('Do cliente A');
    });
  });

  describe('tenant isolation', () => {
    it('blocks cross-tenant access and associations', async () => {
      const contactA = await createContact(ownerA, { customerId: customerA, name: 'A contact' });
      const idA = contactA.json().id as string;

      const associatedWithForeign = await createContact(ownerA, {
        customerId: customerB,
        name: 'Cross tenant',
      });
      expect(associatedWithForeign.statusCode).toBe(404);

      const readAsB = await app.inject({
        method: 'GET',
        url: `/api/contacts/${idA}`,
        headers: authHeaders(ownerB),
      });
      expect(readAsB.statusCode).toBe(404);

      const updateAsB = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${idA}`,
        headers: authHeaders(ownerB),
        payload: { name: 'hacked' },
      });
      expect(updateAsB.statusCode).toBe(404);

      const deleteAsB = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${idA}`,
        headers: authHeaders(ownerB),
      });
      expect(deleteAsB.statusCode).toBe(404);

      const listB = await app.inject({
        method: 'GET',
        url: '/api/contacts',
        headers: authHeaders(ownerB),
      });
      expect(listB.json().data).toHaveLength(0);
    });
  });
});
