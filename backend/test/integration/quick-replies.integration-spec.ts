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

describe('Quick replies (integration)', () => {
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
    ownerA = await seedTenant(app, prisma, { name: 'Quick Reply Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, {
      name: 'Quick Reply User A',
      role: 'USER',
    });
    ownerB = await seedTenant(app, prisma, { name: 'Quick Reply Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  function createQuickReply(tenant: SeededTenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  describe('CRUD', () => {
    it('creates, lists, updates and deletes a quick reply', async () => {
      const created = await createQuickReply(ownerA, {
        title: 'Boas-vindas',
        content: 'Olá! Como podemos ajudar?',
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        title: 'Boas-vindas',
        content: 'Olá! Como podemos ajudar?',
      });
      expect(created.json()).not.toHaveProperty('tenantId');

      const id = created.json().id as string;

      const list = await app.inject({
        method: 'GET',
        url: '/api/quick-replies?sort=title&order=asc',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data).toHaveLength(1);

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/quick-replies/${id}`,
        headers: authHeaders(ownerA),
        payload: { content: 'Olá! Em que podemos ajudar hoje?' },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().content).toBe('Olá! Em que podemos ajudar hoje?');

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/quick-replies/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(removed.statusCode).toBe(204);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/quick-replies/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(404);
    });

    it('allows reading but rejects mutations by a USER role', async () => {
      const created = await createQuickReply(ownerA, {
        title: 'Somente leitura',
        content: 'Conteúdo',
      });
      const id = created.json().id as string;

      const deniedCreate = await createQuickReply(userA, {
        title: 'Criada por usuário',
        content: 'Conteúdo',
      });
      expect(deniedCreate.statusCode).toBe(403);

      const deniedUpdate = await app.inject({
        method: 'PATCH',
        url: `/api/quick-replies/${id}`,
        headers: authHeaders(userA),
        payload: { title: 'Alterada' },
      });
      expect(deniedUpdate.statusCode).toBe(403);

      const deniedDelete = await app.inject({
        method: 'DELETE',
        url: `/api/quick-replies/${id}`,
        headers: authHeaders(userA),
      });
      expect(deniedDelete.statusCode).toBe(403);

      const list = await app.inject({
        method: 'GET',
        url: '/api/quick-replies',
        headers: authHeaders(userA),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it('rejects empty fields and unknown properties', async () => {
      const invalidTitle = await createQuickReply(ownerA, { title: '', content: 'Conteúdo' });
      expect(invalidTitle.statusCode).toBe(400);

      const invalidContent = await createQuickReply(ownerA, { title: 'Título', content: '' });
      expect(invalidContent.statusCode).toBe(400);

      const blankTitle = await createQuickReply(ownerA, { title: '   ', content: 'Conteúdo' });
      expect(blankTitle.statusCode).toBe(400);

      const blankContent = await createQuickReply(ownerA, { title: 'Título', content: '   ' });
      expect(blankContent.statusCode).toBe(400);

      const unknownField = await createQuickReply(ownerA, {
        title: 'Título',
        content: 'Conteúdo',
        tenantId: 'x',
      });
      expect(unknownField.statusCode).toBe(400);
    });

    it('rejects a duplicated title within the same tenant and allows it across tenants', async () => {
      await createQuickReply(ownerA, { title: 'Repetida', content: 'Conteúdo A' });
      const duplicated = await createQuickReply(ownerA, {
        title: 'Repetida',
        content: 'Conteúdo B',
      });
      expect(duplicated.statusCode).toBe(409);
      expect(duplicated.json().code).toBe('QUICK_REPLY_TITLE_CONFLICT');

      const fromB = await createQuickReply(ownerB, {
        title: 'Repetida',
        content: 'Conteúdo B',
      });
      expect(fromB.statusCode).toBe(201);
    });
  });

  describe('search and pagination', () => {
    it('paginates and searches by title or content', async () => {
      await createQuickReply(ownerA, { title: 'Alfa', content: 'Primeira mensagem' });
      await createQuickReply(ownerA, { title: 'Beta', content: 'Segunda mensagem' });
      await createQuickReply(ownerA, { title: 'Gama', content: 'Mensagem final' });

      const page = await app.inject({
        method: 'GET',
        url: '/api/quick-replies?perPage=2&page=1&sort=title&order=asc',
        headers: authHeaders(ownerA),
      });
      expect(page.json().data.map((item: { title: string }) => item.title)).toEqual([
        'Alfa',
        'Beta',
      ]);
      expect(page.json().meta).toMatchObject({ total: 3, totalPages: 2 });

      const search = await app.inject({
        method: 'GET',
        url: '/api/quick-replies?search=final',
        headers: authHeaders(ownerA),
      });
      expect(search.json().data).toHaveLength(1);
      expect(search.json().data[0].title).toBe('Gama');
    });
  });

  describe('tenant isolation', () => {
    it('never reads or mutates another tenant quick reply', async () => {
      const fromB = await createQuickReply(ownerB, {
        title: 'Só do B',
        content: 'Conteúdo B',
      });
      const idB = fromB.json().id as string;

      const listA = await app.inject({
        method: 'GET',
        url: '/api/quick-replies',
        headers: authHeaders(ownerA),
      });
      expect(listA.json().data).toHaveLength(0);

      const readAsA = await app.inject({
        method: 'GET',
        url: `/api/quick-replies/${idB}`,
        headers: authHeaders(ownerA),
      });
      expect(readAsA.statusCode).toBe(404);

      const updateAsA = await app.inject({
        method: 'PATCH',
        url: `/api/quick-replies/${idB}`,
        headers: authHeaders(ownerA),
        payload: { title: 'hacked' },
      });
      expect(updateAsA.statusCode).toBe(404);

      const deleteAsA = await app.inject({
        method: 'DELETE',
        url: `/api/quick-replies/${idB}`,
        headers: authHeaders(ownerA),
      });
      expect(deleteAsA.statusCode).toBe(404);

      const untouched = await prisma.quickReply.findUnique({ where: { id: idB } });
      expect(untouched?.title).toBe('Só do B');
    });
  });
});
