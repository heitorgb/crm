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

  describe('birth date and address', () => {
    it('persists and returns the new profile fields as optional data', async () => {
      const created = await createContact(ownerA, {
        customerId: customerA,
        name: 'Maria Silva',
        birthDate: '1990-02-28',
        address: 'Rua das Flores, 123, Centro, São Paulo/SP, 01000-000',
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        birthDate: '1990-02-28',
        address: 'Rua das Flores, 123, Centro, São Paulo/SP, 01000-000',
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/contacts/${created.json().id}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        birthDate: '1990-02-28',
        address: 'Rua das Flores, 123, Centro, São Paulo/SP, 01000-000',
      });
    });

    it('creates contacts without the new fields and clears them on update', async () => {
      const created = await createContact(ownerA, { name: 'Sem dados extras' });
      expect(created.statusCode).toBe(201);
      expect(created.json().birthDate).toBeNull();
      expect(created.json().address).toBeNull();

      const id = created.json().id as string;
      const filled = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        headers: authHeaders(ownerA),
        payload: { birthDate: '1985-12-31', address: 'Avenida Brasil, 10' },
      });
      expect(filled.statusCode).toBe(200);
      expect(filled.json()).toMatchObject({
        birthDate: '1985-12-31',
        address: 'Avenida Brasil, 10',
      });

      const cleared = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        headers: authHeaders(ownerA),
        payload: { birthDate: null, address: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().birthDate).toBeNull();
      expect(cleared.json().address).toBeNull();
    });

    it('preserves the new fields when other data is updated', async () => {
      const created = await createContact(ownerA, {
        name: 'Campos preservados',
        birthDate: '2000-01-15',
        address: 'Rua A, 1',
      });
      const id = created.json().id as string;

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        headers: authHeaders(ownerA),
        payload: { position: 'Gerente' },
      });

      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        position: 'Gerente',
        birthDate: '2000-01-15',
        address: 'Rua A, 1',
      });
    });

    it('rejects invalid birth dates', async () => {
      for (const birthDate of ['31/12/1990', '1990-02-31', 'not-a-date']) {
        const response = await createContact(ownerA, { name: 'Data inválida', birthDate });
        expect(response.statusCode).toBe(400);
      }
    });

    it('keeps legacy contacts without the new fields editable', async () => {
      const legacy = await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, name: 'Contato legado' },
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/contacts/${legacy.id}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ birthDate: null, address: null });

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${legacy.id}`,
        headers: authHeaders(ownerA),
        payload: { name: 'Contato legado editado' },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        name: 'Contato legado editado',
        birthDate: null,
        address: null,
      });
    });

    it('includes the new fields in the customer contacts response', async () => {
      await createContact(ownerA, {
        customerId: customerA,
        name: 'Contato do cliente',
        birthDate: '1992-06-10',
        address: 'Rua B, 20',
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/customers/${customerA}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().contacts[0]).toMatchObject({
        birthDate: '1992-06-10',
        address: 'Rua B, 20',
      });
    });
  });

  describe('blocking', () => {
    it('defaults new contacts to unblocked', async () => {
      const created = await createContact(ownerA, { name: 'Normal' });

      expect(created.statusCode).toBe(201);
      expect(created.json().isBlocked).toBe(false);
    });

    it('creates a blocked contact and allows unblocking it', async () => {
      const created = await createContact(ownerA, {
        name: 'Bloqueado',
        phone: '+55 11 90000-0000',
        isBlocked: true,
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().isBlocked).toBe(true);

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${created.json().id}`,
        headers: authHeaders(ownerA),
        payload: { isBlocked: false },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().isBlocked).toBe(false);
    });
  });

  describe('validation', () => {
    it('requires a name and validates the email', async () => {
      const missingName = await createContact(ownerA, { customerId: customerA });
      expect(missingName.statusCode).toBe(400);

      const invalidEmail = await createContact(ownerA, {
        customerId: customerA,
        name: 'Email inválido',
        email: 'not-an-email',
      });
      expect(invalidEmail.statusCode).toBe(400);
    });

    it('allows a contact without a customer', async () => {
      const response = await createContact(ownerA, {
        name: 'Sem empresa',
        phone: '+55 11 98888-7777',
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().customerId).toBeNull();
      expect(response.json().customerName).toBeNull();
      expect(response.json().phone).toBe('5511988887777');
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

  describe('phone identity', () => {
    it('normalizes the phone and rejects duplicates inside the tenant', async () => {
      const first = await createContact(ownerA, { name: 'Ana', phone: '+55 (11) 91111-2222' });
      expect(first.statusCode).toBe(201);
      expect(first.json().phone).toBe('5511911112222');

      const duplicate = await createContact(ownerA, { name: 'Outra Ana', phone: '5511911112222' });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().code).toBe('CONTACT_PHONE_CONFLICT');
    });

    it('allows the same phone in different tenants', async () => {
      const createdA = await createContact(ownerA, { name: 'A', phone: '5511911113333' });
      expect(createdA.statusCode).toBe(201);

      const createdB = await createContact(ownerB, { name: 'B', phone: '5511911113333' });
      expect(createdB.statusCode).toBe(201);
    });
  });

  describe('list filters and summary', () => {
    beforeEach(async () => {
      await createContact(ownerA, {
        name: 'Principal completa',
        phone: '5511900000001',
        email: 'principal@example.com',
        birthDate: '1990-01-01',
        address: 'Rua A, 1',
        isPrimary: true,
      });
      await createContact(ownerA, {
        name: 'Bloqueada incompleta',
        phone: '5511900000002',
        isBlocked: true,
      });
      await createContact(ownerA, {
        name: 'Completa secundária',
        phone: '5511900000003',
        email: 'secundaria@example.com',
        birthDate: '1991-02-02',
        address: 'Rua B, 2',
      });
    });

    it('filters contacts by primary, blocked and incomplete data', async () => {
      const primary = await app.inject({
        method: 'GET',
        url: '/api/contacts?filter=primary',
        headers: authHeaders(ownerA),
      });
      expect(primary.statusCode).toBe(200);
      expect(primary.json().data.map((item: { name: string }) => item.name)).toEqual([
        'Principal completa',
      ]);

      const blocked = await app.inject({
        method: 'GET',
        url: '/api/contacts?filter=blocked',
        headers: authHeaders(ownerA),
      });
      expect(blocked.json().data.map((item: { name: string }) => item.name)).toEqual([
        'Bloqueada incompleta',
      ]);

      const incomplete = await app.inject({
        method: 'GET',
        url: '/api/contacts?filter=incomplete',
        headers: authHeaders(ownerA),
      });
      expect(incomplete.json().data.map((item: { name: string }) => item.name)).toEqual([
        'Bloqueada incompleta',
      ]);
    });

    it('applies the extra filters used by the compact menu', async () => {
      const withEmail = await app.inject({
        method: 'GET',
        url: '/api/contacts?extraFilter=with_email',
        headers: authHeaders(ownerA),
      });
      expect(withEmail.statusCode).toBe(200);
      expect(withEmail.json().data).toHaveLength(2);
      expect(
        withEmail.json().data.every((item: { email: string | null }) => item.email !== null),
      ).toBe(true);

      const withCustomer = await app.inject({
        method: 'GET',
        url: '/api/contacts?extraFilter=with_customer',
        headers: authHeaders(ownerA),
      });
      expect(withCustomer.json().data).toHaveLength(0);

      const summary = await app.inject({
        method: 'GET',
        url: '/api/contacts?extraFilter=with_email&includeSummary=true',
        headers: authHeaders(ownerA),
      });
      expect(summary.json().summary).toEqual({
        total: 2,
        primary: 1,
        blocked: 0,
        incomplete: 0,
      });
    });

    it('combines search with the quick filters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/contacts?search=Bloqueada&filter=incomplete',
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].name).toBe('Bloqueada incompleta');
    });

    it('returns summary counts for the current search and tenant', async () => {
      const all = await app.inject({
        method: 'GET',
        url: '/api/contacts?includeSummary=true',
        headers: authHeaders(ownerA),
      });
      expect(all.statusCode).toBe(200);
      expect(all.json().summary).toEqual({
        total: 3,
        primary: 1,
        blocked: 1,
        incomplete: 1,
      });

      const filtered = await app.inject({
        method: 'GET',
        url: '/api/contacts?filter=blocked&includeSummary=true',
        headers: authHeaders(ownerA),
      });
      expect(filtered.json().meta.total).toBe(1);
      expect(filtered.json().summary).toEqual(all.json().summary);

      const searched = await app.inject({
        method: 'GET',
        url: '/api/contacts?search=Principal&includeSummary=true',
        headers: authHeaders(ownerA),
      });
      expect(searched.json().meta.total).toBe(1);
      expect(searched.json().summary).toMatchObject({
        total: 1,
        primary: 1,
        blocked: 0,
        incomplete: 0,
      });

      const otherTenant = await app.inject({
        method: 'GET',
        url: '/api/contacts?includeSummary=true',
        headers: authHeaders(ownerB),
      });
      expect(otherTenant.json().summary).toEqual({
        total: 0,
        primary: 0,
        blocked: 0,
        incomplete: 0,
      });
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
