import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { EvolutionRequestError } from '../../src/modules/whatsapp/evolution/evolution.client.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

class FakeEvolution {
  configured = true;
  readonly sent: { instance: string; number: string; text: string }[] = [];
  readonly created: string[] = [];
  readonly webhooks: { instance: string; url: string; events: string[] }[] = [];
  createInstanceError?: { status: number };
  private counter = 0;

  async createInstance(instanceName: string) {
    if (this.createInstanceError) {
      throw new EvolutionRequestError('instance exists', this.createInstanceError.status);
    }
    this.created.push(instanceName);
    return { qrcode: { base64: 'ZmFrZS1xcg==', code: '2@fake' }, pairingCode: '12345678' };
  }

  async sendText(instance: string, number: string, text: string) {
    this.counter += 1;
    this.sent.push({ instance, number, text });
    return { externalMessageId: `ext-${this.counter}`, raw: {} };
  }

  async connect() {
    return { code: '2@existing', base64: 'ZXhpc3Rpbmc=' };
  }

  async disconnect() {
    return {};
  }

  async getConnectionState() {
    return { instance: 'fake', state: 'open' };
  }

  async setWebhook(instance: string, url: string, events: string[]) {
    this.webhooks.push({ instance, url, events });
    return {};
  }
}

const evolution = new FakeEvolution();

describe('WhatsApp attendance (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp({ evolution });
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    evolution.sent.length = 0;
    evolution.created.length = 0;
    evolution.webhooks.length = 0;
    evolution.createInstanceError = undefined;
    ownerA = await seedTenant(app, prisma, { name: 'Wa Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Wa User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Wa Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  async function createInstance(tenant: SeededTenant, instanceName: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/whatsapp/instances',
      headers: authHeaders(tenant),
      payload: {
        name: `${instanceName} display`,
        instanceName,
        credentials: { apiKey: 'super-secret-key', webhookSecret: 'super-secret-webhook' },
      },
    });
    return response.json().id as string;
  }

  function evolutionPayload(
    instanceName: string,
    messageId: string,
    text: string,
    remoteJid = '5511999999999@s.whatsapp.net',
  ) {
    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: { remoteJid, fromMe: false, id: messageId },
        pushName: 'Contato Teste',
        message: { conversation: text },
      },
    };
  }

  function postWebhook(payload: object, token = 'test-webhook-secret') {
    return app.inject({
      method: 'POST',
      url: `/api/webhooks/evolution?token=${token}`,
      payload,
    });
  }

  describe('instances', () => {
    it('creates an instance without exposing credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/instances',
        headers: authHeaders(ownerA),
        payload: {
          name: 'Atendimento',
          instanceName: `inst-${randomUUID()}`,
          credentials: { apiKey: 'secret-value', webhookSecret: 'webhook-value' },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().hasCredentials).toBe(true);
      expect(JSON.stringify(response.json())).not.toContain('secret-value');
      expect(response.json()).not.toHaveProperty('credentialsEncrypted');
    });

    it('rejects duplicated instance names and enforces authorization', async () => {
      const instanceName = `dup-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const duplicated = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/instances',
        headers: authHeaders(ownerA),
        payload: { name: 'X', instanceName },
      });
      expect(duplicated.statusCode).toBe(409);

      const forbidden = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/instances',
        headers: authHeaders(userA),
        payload: { name: 'X', instanceName: `user-${randomUUID()}` },
      });
      expect(forbidden.statusCode).toBe(403);
    });

    it('never exposes another tenant instance', async () => {
      const instanceId = await createInstance(ownerB, `foreign-${randomUUID()}`);

      const read = await app.inject({
        method: 'GET',
        url: `/api/whatsapp/instances/${instanceId}`,
        headers: authHeaders(ownerA),
      });
      expect(read.statusCode).toBe(404);

      const list = await app.inject({
        method: 'GET',
        url: '/api/whatsapp/instances',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data).toHaveLength(0);
    });

    it('refreshes connection state from the provider', async () => {
      const instanceId = await createInstance(ownerA, `status-${randomUUID()}`);
      const response = await app.inject({
        method: 'GET',
        url: `/api/whatsapp/instances/${instanceId}/status`,
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('CONNECTED');
    });

    it('creates the instance in Evolution, returns a connection ticket and configures the webhook', async () => {
      const instanceName = `connect-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        status: 'CONNECTING',
        pairingCode: '12345678',
        code: '2@fake',
      });
      expect(response.json().qrCodeBase64).toContain('data:image/png;base64,');

      expect(evolution.created).toContain(instanceName);
      const webhook = evolution.webhooks.find((item) => item.instance === instanceName);
      expect(webhook?.events).toEqual(['MESSAGES_UPSERT']);
      expect(webhook?.url).toContain('/api/webhooks/evolution?token=');
      expect(JSON.stringify(response.json())).not.toContain('super-secret-webhook');
    });

    it('falls back to an existing Evolution instance', async () => {
      const instanceName = `existing-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      evolution.createInstanceError = { status: 409 };

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().code).toBe('2@existing');
      expect(evolution.created).not.toContain(instanceName);
    });

    it('restricts webhook configuration to OWNER/ADMIN and masks the secret', async () => {
      const instanceId = await createInstance(ownerA, `wh-${randomUUID()}`);

      const forbidden = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/webhook`,
        headers: authHeaders(userA),
      });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/webhook`,
        headers: authHeaders(ownerA),
      });
      expect(allowed.statusCode).toBe(201);
      expect(allowed.json().webhookConfigured).toBe(true);
      expect(allowed.json().webhookUrl).not.toContain('token=');
    });

    it('never allows connecting an instance from another tenant', async () => {
      const instanceId = await createInstance(ownerB, `foreign-conn-${randomUUID()}`);
      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('webhook', () => {
    it('rejects an invalid secret', async () => {
      const response = await postWebhook(evolutionPayload('x', randomUUID(), 'oi'), 'wrong');
      expect(response.statusCode).toBe(401);
    });

    it('ignores an unknown instance', async () => {
      const response = await postWebhook(evolutionPayload('missing-instance', randomUUID(), 'oi'));
      expect(response.statusCode).toBe(200);
      expect(response.json().ignored).toBe('unknown_instance');
    });

    it('persists the message, creates the contact and opens the conversation', async () => {
      const instanceName = `inbound-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const response = await postWebhook(
        evolutionPayload(instanceName, randomUUID(), 'Olá, tudo bem?'),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);

      const conversation = await prisma.conversation.findFirst({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation?.status).toBe('OPEN');
      expect(conversation?.contactId).not.toBeNull();

      const contact = await prisma.contact.findFirst({ where: { tenantId: ownerA.tenantId } });
      expect(contact?.phone).toBe('5511999999999');
      expect(contact?.name).toBe('Contato Teste');

      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(messages).toHaveLength(1);
      expect(messages[0].direction).toBe('INBOUND');
      expect(messages[0].content).toBe('Olá, tudo bem?');

      // The messaging bot no longer answers automatically.
      expect(evolution.sent).toHaveLength(0);
    });

    it('reuses the existing contact for the same phone inside the tenant', async () => {
      const instanceName = `dedupe-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Primeira'));
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Segunda'));

      const contacts = await prisma.contact.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(contacts).toHaveLength(1);

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);
    });

    it('ignores duplicated events and messages', async () => {
      const instanceName = `dup-msg-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const messageId = randomUUID();
      const payload = evolutionPayload(instanceName, messageId, 'Primeira mensagem');

      await postWebhook(payload);
      const second = await postWebhook(payload);

      expect(second.json().ignored).toBe('duplicate_event');

      const inbound = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(inbound).toHaveLength(1);
    });

    it('reopens a closed conversation when a new message arrives', async () => {
      const instanceName = `reopen-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Voltei'));

      const reopened = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(reopened.status).toBe('OPEN');
      expect(reopened.closedAt).toBeNull();
    });

    it('keeps one contact across conversations from different WhatsApps', async () => {
      const instanceA = `comercial-${randomUUID()}`;
      const instanceB = `suporte-${randomUUID()}`;
      await createInstance(ownerA, instanceA);
      await createInstance(ownerA, instanceB);

      await postWebhook(evolutionPayload(instanceA, randomUUID(), 'Quero comprar'));
      await postWebhook(evolutionPayload(instanceB, randomUUID(), 'Preciso de ajuda'));

      const contacts = await prisma.contact.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(contacts).toHaveLength(1);

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(2);
      expect(new Set(conversations.map((item) => item.contactId))).toEqual(
        new Set([contacts[0].id]),
      );
    });
  });

  describe('conversations and messages', () => {
    async function seedConversation(): Promise<{
      conversationId: string;
      instanceName: string;
      contactId: string;
    }> {
      const instanceName = `conv-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      return {
        conversationId: conversation.id,
        instanceName,
        contactId: conversation.contactId as string,
      };
    }

    it('lists conversations and messages, and sends without takeover', async () => {
      const { conversationId } = await seedConversation();

      const list = await app.inject({
        method: 'GET',
        url: '/api/conversations',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data).toHaveLength(1);
      expect(list.json().data[0].contactName).toBe('Contato Teste');

      const messages = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversationId}/messages`,
        headers: authHeaders(ownerA),
      });
      expect(messages.statusCode).toBe(200);
      expect(messages.json().data.length).toBeGreaterThan(0);

      const before = evolution.sent.length;
      const sent = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Olá, sou o atendente' },
      });
      expect(sent.statusCode).toBe(201);
      expect(evolution.sent.length).toBe(before + 1);

      const outbound = await prisma.message.findFirst({
        where: { tenantId: ownerA.tenantId, direction: 'OUTBOUND' },
      });
      expect(outbound?.content).toBe('Olá, sou o atendente');
      expect(outbound?.status).toBe('SENT');
    });

    it('filters conversations by WhatsApp instance and by contact', async () => {
      const instanceA = `filter-a-${randomUUID()}`;
      const instanceB = `filter-b-${randomUUID()}`;
      await createInstance(ownerA, instanceA);
      await createInstance(ownerA, instanceB);
      await postWebhook(evolutionPayload(instanceA, randomUUID(), 'a', '5511888888888@s.whatsapp.net'));
      await postWebhook(evolutionPayload(instanceB, randomUUID(), 'b', '5511777777777@s.whatsapp.net'));

      const instanceList = await app.inject({
        method: 'GET',
        url: `/api/whatsapp/instances`,
        headers: authHeaders(ownerA),
      });
      const target = (instanceList.json().data as { id: string; instanceName: string }[]).find(
        (item) => item.instanceName === instanceA,
      );

      const byInstance = await app.inject({
        method: 'GET',
        url: `/api/conversations?whatsappInstanceId=${target?.id}`,
        headers: authHeaders(ownerA),
      });
      expect(byInstance.json().data).toHaveLength(1);

      const contact = await prisma.contact.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, phone: '5511888888888' },
      });
      const byContact = await app.inject({
        method: 'GET',
        url: `/api/conversations?contactId=${contact.id}`,
        headers: authHeaders(ownerA),
      });
      expect(byContact.json().data).toHaveLength(1);
    });

    it('closes and reopens a conversation through the API', async () => {
      const { conversationId } = await seedConversation();

      const closed = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/close`,
        headers: authHeaders(ownerA),
      });
      expect(closed.json().status).toBe('CLOSED');
      expect(closed.json().closedAt).not.toBeNull();

      const reopened = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/takeover`,
        headers: authHeaders(ownerA),
      });
      expect(reopened.json().status).toBe('OPEN');
    });

    it('never exposes another tenant conversation', async () => {
      const { conversationId } = await seedConversation();

      const read = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversationId}`,
        headers: authHeaders(ownerB),
      });
      expect(read.statusCode).toBe(404);

      const listB = await app.inject({
        method: 'GET',
        url: '/api/conversations',
        headers: authHeaders(ownerB),
      });
      expect(listB.json().data).toHaveLength(0);
    });
  });
});
