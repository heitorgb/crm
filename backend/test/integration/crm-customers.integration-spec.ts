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

describe('Customers (integration)', () => {
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
    ownerA = await seedTenant(app, prisma, { name: 'Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  function createCustomer(tenant: SeededTenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  describe('CRUD', () => {
    it('creates and reads a customer scoped to the tenant', async () => {
      const created = await createCustomer(ownerA, { name: 'Acme Ltda', document: '12345678000199' });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        name: 'Acme Ltda',
        document: '12345678000199',
        status: 'ACTIVE',
        tags: [],
        contacts: [],
      });
      expect(created.json().id).toEqual(expect.any(String));
      expect(created.json()).not.toHaveProperty('tenantId');

      const detail = await app.inject({
        method: 'GET',
        url: `/api/customers/${created.json().id}`,
        headers: authHeaders(ownerA),
      });

      expect(detail.statusCode).toBe(200);
      expect(detail.json().id).toBe(created.json().id);
    });

    it('updates a customer and can clear the document', async () => {
      const created = await createCustomer(ownerA, { name: 'Acme', document: '111' });
      const id = created.json().id as string;

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/customers/${id}`,
        headers: authHeaders(ownerA),
        payload: { name: 'Acme Renomeada', document: null, status: 'INACTIVE' },
      });

      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ name: 'Acme Renomeada', document: null, status: 'INACTIVE' });
    });

    it('deletes a customer as OWNER and not as USER', async () => {
      const allowed = await createCustomer(ownerA, { name: 'Delete me' });
      const allowedId = allowed.json().id as string;

      const forbidden = await app.inject({
        method: 'DELETE',
        url: `/api/customers/${allowedId}`,
        headers: authHeaders(userA),
      });
      expect(forbidden.statusCode).toBe(403);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/customers/${allowedId}`,
        headers: authHeaders(ownerA),
      });
      expect(removed.statusCode).toBe(204);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/customers/${allowedId}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(404);
    });
  });

  describe('validation', () => {
    it('rejects an empty name', async () => {
      const response = await createCustomer(ownerA, { name: '' });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an invalid status and unknown fields', async () => {
      const invalidStatus = await createCustomer(ownerA, { name: 'Valid', status: 'WHATEVER' });
      expect(invalidStatus.statusCode).toBe(400);

      const unknownField = await createCustomer(ownerA, { name: 'Valid', tenantId: 'x' });
      expect(unknownField.statusCode).toBe(400);
    });

    it('rejects an invalid uuid on read', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/customers/not-a-uuid',
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a duplicated document within the tenant', async () => {
      await createCustomer(ownerA, { name: 'First', document: '999' });
      const duplicated = await createCustomer(ownerA, { name: 'Second', document: '999' });

      expect(duplicated.statusCode).toBe(409);
      expect(duplicated.json().code).toBe('CUSTOMER_DOCUMENT_CONFLICT');
    });
  });

  describe('tags', () => {
    it('assigns only tags from the same tenant', async () => {
      const tagResponse = await app.inject({
        method: 'POST',
        url: '/api/tags',
        headers: authHeaders(ownerA),
        payload: { name: 'VIP', color: '#22C55E' },
      });
      const tagId = tagResponse.json().id as string;

      const created = await createCustomer(ownerA, { name: 'Tagged', tagIds: [tagId] });
      expect(created.statusCode).toBe(201);
      expect(created.json().tags).toEqual([{ id: tagId, name: 'VIP', color: '#22C55E' }]);
    });

    it('rejects tags from another tenant', async () => {
      const foreignTag = await prisma.tag.create({
        data: { tenantId: ownerB.tenantId, name: 'Foreign' },
      });

      const response = await createCustomer(ownerA, { name: 'Nope', tagIds: [foreignTag.id] });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('CUSTOMER_TAG_NOT_FOUND');
    });
  });

  describe('pagination and search', () => {
    it('paginates results and reports totals', async () => {
      await createCustomer(ownerA, { name: 'Alpha' });
      await createCustomer(ownerA, { name: 'Bravo' });
      await createCustomer(ownerA, { name: 'Charlie' });

      const firstPage = await app.inject({
        method: 'GET',
        url: '/api/customers?perPage=2&page=1&sort=name&order=asc',
        headers: authHeaders(ownerA),
      });

      expect(firstPage.statusCode).toBe(200);
      expect(firstPage.json().data).toHaveLength(2);
      expect(firstPage.json().meta).toMatchObject({ page: 1, perPage: 2, total: 3, totalPages: 2 });
      expect(firstPage.json().data.map((item: { name: string }) => item.name)).toEqual(['Alpha', 'Bravo']);

      const secondPage = await app.inject({
        method: 'GET',
        url: '/api/customers?perPage=2&page=2&sort=name&order=asc',
        headers: authHeaders(ownerA),
      });
      expect(secondPage.json().data.map((item: { name: string }) => item.name)).toEqual(['Charlie']);
    });

    it('caps perPage at 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/customers?perPage=500',
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(400);
    });

    it('searches by name and document', async () => {
      await createCustomer(ownerA, { name: 'Global Foods', document: 'AAA-1' });
      await createCustomer(ownerA, { name: 'Outra Empresa', document: 'BBB-2' });

      const byName = await app.inject({
        method: 'GET',
        url: '/api/customers?search=global',
        headers: authHeaders(ownerA),
      });
      expect(byName.json().data).toHaveLength(1);
      expect(byName.json().data[0].name).toBe('Global Foods');

      const byDocument = await app.inject({
        method: 'GET',
        url: '/api/customers?search=BBB-2',
        headers: authHeaders(ownerA),
      });
      expect(byDocument.json().data).toHaveLength(1);
      expect(byDocument.json().data[0].name).toBe('Outra Empresa');
    });

    it('filters by status', async () => {
      await createCustomer(ownerA, { name: 'Ativo', status: 'ACTIVE' });
      await createCustomer(ownerA, { name: 'Inativo', status: 'INACTIVE' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/customers?status=INACTIVE',
        headers: authHeaders(ownerA),
      });

      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].name).toBe('Inativo');
    });
  });

  describe('tenant isolation', () => {
    it('never lists or reads another tenant customer', async () => {
      const customerB = await createCustomer(ownerB, { name: 'Tenant B only' });
      const idB = customerB.json().id as string;

      await createCustomer(ownerA, { name: 'Tenant A only' });

      const listA = await app.inject({
        method: 'GET',
        url: '/api/customers',
        headers: authHeaders(ownerA),
      });
      expect(listA.json().data.map((item: { name: string }) => item.name)).toEqual(['Tenant A only']);

      const readBAsA = await app.inject({
        method: 'GET',
        url: `/api/customers/${idB}`,
        headers: authHeaders(ownerA),
      });
      expect(readBAsA.statusCode).toBe(404);

      const updateBAsA = await app.inject({
        method: 'PATCH',
        url: `/api/customers/${idB}`,
        headers: authHeaders(ownerA),
        payload: { name: 'hacked' },
      });
      expect(updateBAsA.statusCode).toBe(404);

      const deleteBAsA = await app.inject({
        method: 'DELETE',
        url: `/api/customers/${idB}`,
        headers: authHeaders(ownerA),
      });
      expect(deleteBAsA.statusCode).toBe(404);

      const untouched = await prisma.customer.findUnique({ where: { id: idB } });
      expect(untouched?.name).toBe('Tenant B only');
    });

    it('requires authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/customers' });
      expect(response.statusCode).toBe(401);
    });
  });
});
