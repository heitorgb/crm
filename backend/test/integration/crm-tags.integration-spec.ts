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

describe('Tags (integration)', () => {
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
    ownerA = await seedTenant(app, prisma, { name: 'Tag Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Tag User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Tag Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  function createTag(tenant: SeededTenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  describe('CRUD', () => {
    it('creates, lists, updates and deletes a tag', async () => {
      const created = await createTag(ownerA, { name: 'VIP', color: '#22C55E' });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ name: 'VIP', color: '#22C55E', customerCount: 0 });
      expect(created.json()).not.toHaveProperty('tenantId');

      const id = created.json().id as string;

      const list = await app.inject({
        method: 'GET',
        url: '/api/tags?sort=name&order=asc',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data).toHaveLength(1);

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/tags/${id}`,
        headers: authHeaders(ownerA),
        payload: { name: 'VIP Gold', color: null },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ name: 'VIP Gold', color: null });

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/tags/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(removed.statusCode).toBe(204);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/tags/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(404);
    });

    it('rejects delete by a USER role', async () => {
      const created = await createTag(ownerA, { name: 'Somente leitura' });
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/tags/${created.json().id}`,
        headers: authHeaders(userA),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects an invalid color and empty name', async () => {
      const invalidColor = await createTag(ownerA, { name: 'Cor', color: 'green' });
      expect(invalidColor.statusCode).toBe(400);

      const invalidName = await createTag(ownerA, { name: '' });
      expect(invalidName.statusCode).toBe(400);

      const unknownField = await createTag(ownerA, { name: 'Cor', tenantId: 'x' });
      expect(unknownField.statusCode).toBe(400);
    });

    it('rejects a duplicated name within the same tenant', async () => {
      await createTag(ownerA, { name: 'Repetida' });
      const duplicated = await createTag(ownerA, { name: 'Repetida' });

      expect(duplicated.statusCode).toBe(409);
      expect(duplicated.json().code).toBe('TAG_NAME_CONFLICT');
    });

    it('allows the same tag name in different tenants', async () => {
      const fromA = await createTag(ownerA, { name: 'Compartilhado' });
      const fromB = await createTag(ownerB, { name: 'Compartilhado' });

      expect(fromA.statusCode).toBe(201);
      expect(fromB.statusCode).toBe(201);
    });
  });

  describe('search and pagination', () => {
    it('paginates and searches tags', async () => {
      await createTag(ownerA, { name: 'Alfa' });
      await createTag(ownerA, { name: 'Beta' });
      await createTag(ownerA, { name: 'Gama' });

      const page = await app.inject({
        method: 'GET',
        url: '/api/tags?perPage=2&page=1&sort=name&order=asc',
        headers: authHeaders(ownerA),
      });
      expect(page.json().data.map((item: { name: string }) => item.name)).toEqual(['Alfa', 'Beta']);
      expect(page.json().meta).toMatchObject({ total: 3, totalPages: 2 });

      const search = await app.inject({
        method: 'GET',
        url: '/api/tags?search=gam',
        headers: authHeaders(ownerA),
      });
      expect(search.json().data).toHaveLength(1);
      expect(search.json().data[0].name).toBe('Gama');
    });
  });

  describe('associations and isolation', () => {
    it('tracks the number of associated customers', async () => {
      const tag = await createTag(ownerA, { name: 'Contada' });
      const tagId = tag.json().id as string;
      const customer = await prisma.customer.create({
        data: { tenantId: ownerA.tenantId, name: 'Cliente' },
      });
      await prisma.customerTag.create({
        data: { tenantId: ownerA.tenantId, customerId: customer.id, tagId },
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/tags/${tagId}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.json().customerCount).toBe(1);
    });

    it('never reads or mutates another tenant tag', async () => {
      const tagB = await createTag(ownerB, { name: 'Só do B' });
      const tagBId = tagB.json().id as string;

      const listA = await app.inject({
        method: 'GET',
        url: '/api/tags',
        headers: authHeaders(ownerA),
      });
      expect(listA.json().data).toHaveLength(0);

      const readAsA = await app.inject({
        method: 'GET',
        url: `/api/tags/${tagBId}`,
        headers: authHeaders(ownerA),
      });
      expect(readAsA.statusCode).toBe(404);

      const updateAsA = await app.inject({
        method: 'PATCH',
        url: `/api/tags/${tagBId}`,
        headers: authHeaders(ownerA),
        payload: { name: 'hacked' },
      });
      expect(updateAsA.statusCode).toBe(404);

      const deleteAsA = await app.inject({
        method: 'DELETE',
        url: `/api/tags/${tagBId}`,
        headers: authHeaders(ownerA),
      });
      expect(deleteAsA.statusCode).toBe(404);

      const untouched = await prisma.tag.findUnique({ where: { id: tagBId } });
      expect(untouched?.name).toBe('Só do B');
    });
  });
});
