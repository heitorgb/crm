import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

interface Seeded {
  tenant: SeededTenant;
  instance: { id: string };
}

describe('Start conversation from contact (integration)', () => {
  let harness: TestApp;
  let prisma: PrismaService;
  const seeded: SeededTenant[] = [];

  beforeAll(async () => {
    harness = await createTestApp();
    prisma = harness.prisma;
  });

  afterAll(async () => {
    await cleanupTenants(prisma, seeded);
    await harness.close();
  });

  async function seedWithInstance(name: string): Promise<Seeded> {
    const tenant = await seedTenant(harness.app, prisma, { name });
    seeded.push(tenant);

    const instance = await prisma.whatsAppInstance.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Loja',
        instanceName: `inst-${randomUUID()}`,
        status: 'CONNECTED',
        active: true,
      },
      select: { id: true },
    });

    return { tenant, instance };
  }

  async function createContact(
    tenant: SeededTenant,
    payload: { name: string; phone?: string },
  ): Promise<{ id: string; phone: string | null }> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: authHeaders(tenant),
      payload,
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  function start(tenant: SeededTenant, body: { contactId: string; whatsappInstanceId: string }) {
    return harness.app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  it('creates a conversation for a contact and is idempotent', async () => {
    const { tenant, instance } = await seedWithInstance('Start');
    const contact = await createContact(tenant, { name: 'Ana', phone: '+55 11 98888-7777' });

    const first = await start(tenant, { contactId: contact.id, whatsappInstanceId: instance.id });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      contactId: contact.id,
      externalContactId: '5511988887777@s.whatsapp.net',
      status: 'OPEN',
    });

    const second = await start(tenant, { contactId: contact.id, whatsappInstanceId: instance.id });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
  });

  it('reopens a closed conversation', async () => {
    const { tenant, instance } = await seedWithInstance('Reopen');
    const contact = await createContact(tenant, { name: 'Bruno', phone: '5511977776666' });
    const created = await start(tenant, { contactId: contact.id, whatsappInstanceId: instance.id });

    await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${created.json().id}/close`,
      headers: authHeaders(tenant),
      payload: {},
    });

    const again = await start(tenant, { contactId: contact.id, whatsappInstanceId: instance.id });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(created.json().id);
    expect(again.json().status).toBe('OPEN');
  });

  it('links an existing inbound conversation by phone JID', async () => {
    const { tenant, instance } = await seedWithInstance('Link');
    const contact = await createContact(tenant, { name: 'Carla', phone: '5511966665555' });
    const existing = await prisma.conversation.create({
      data: {
        tenantId: tenant.tenantId,
        whatsappInstanceId: instance.id,
        externalContactId: '5511966665555@s.whatsapp.net',
        isGroup: false,
        status: 'OPEN',
      },
      select: { id: true },
    });

    const response = await start(tenant, { contactId: contact.id, whatsappInstanceId: instance.id });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(existing.id);
    expect(response.json().contactId).toBe(contact.id);
  });

  it('rejects a contact without phone', async () => {
    const { tenant, instance } = await seedWithInstance('NoPhone');
    const contact = await createContact(tenant, { name: 'Sem Fone' });

    const response = await start(tenant, { contactId: contact.id, whatsappInstanceId: instance.id });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('CONTACT_PHONE_REQUIRED');
  });

  it('isolates contacts and instances across tenants', async () => {
    const a = await seedWithInstance('IsoA');
    const b = await seedWithInstance('IsoB');
    const contactA = await createContact(a.tenant, { name: 'Isolado', phone: '5511955554444' });
    const contactB = await createContact(b.tenant, { name: 'Local', phone: '5511944443333' });

    const foreignContact = await start(b.tenant, {
      contactId: contactA.id,
      whatsappInstanceId: b.instance.id,
    });
    expect(foreignContact.statusCode).toBe(404);
    expect(foreignContact.json().code).toBe('CONTACT_NOT_FOUND');

    const foreignInstance = await start(b.tenant, {
      contactId: contactB.id,
      whatsappInstanceId: a.instance.id,
    });
    expect(foreignInstance.statusCode).toBe(404);
    expect(foreignInstance.json().code).toBe('WHATSAPP_INSTANCE_NOT_FOUND');
  });
});
