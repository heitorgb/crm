import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../src/infrastructure/realtime/realtime.service.js';
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

interface SentMedia {
  instance: string;
  number: string;
  mediatype: string;
  media: string;
  fileName?: string;
  caption?: string;
  mimetype?: string;
}

class FakeEvolution {
  configured = true;
  readonly sent: { instance: string; number: string; text: string }[] = [];
  readonly sentMedia: SentMedia[] = [];
  readonly sentAudio: { instance: string; number: string; audio: string }[] = [];
  readonly created: string[] = [];
  readonly webhooks: { instance: string; url: string; events: string[] }[] = [];
  readonly groupLookups: string[] = [];
  readonly avatarLookups: string[] = [];
  createInstanceError?: { status: number };
  mediaBase64?: string;
  mediaError?: { status: number };
  mediaMimeType?: string;
  mediaFileName?: string | null;
  mediaSize?: number;
  groupSubject: string | null = 'Grupo Teste';
  groupPictureUrl: string | null = 'https://cdn.example/group.jpg';
  avatarUrl: string | null = 'https://cdn.example/avatar.jpg';
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

  async sendMedia(instance: string, input: SentMedia) {
    this.counter += 1;
    this.sentMedia.push({ ...input, instance });
    return { externalMessageId: `media-${this.counter}`, raw: {} };
  }

  async sendWhatsAppAudio(instance: string, input: { number: string; audio: string }) {
    this.counter += 1;
    this.sentAudio.push({ ...input, instance });
    return { externalMessageId: `audio-${this.counter}`, raw: {} };
  }

  async getBase64FromMediaMessage() {
    if (this.mediaError) {
      throw new EvolutionRequestError('media unavailable', this.mediaError.status);
    }
    if (!this.mediaBase64) {
      throw new EvolutionRequestError('media unavailable', 404);
    }
    return {
      base64: this.mediaBase64,
      mimeType: this.mediaMimeType ?? 'image/png',
      fileName: this.mediaFileName === undefined ? 'photo.png' : this.mediaFileName,
      caption: null,
      size: this.mediaSize ?? null,
    };
  }

  async findGroupInfos(_instance: string, groupJid: string) {
    this.groupLookups.push(groupJid);
    if (!this.groupSubject && !this.groupPictureUrl) {
      return null;
    }
    return {
      groupJid,
      subject: this.groupSubject,
      pictureUrl: this.groupPictureUrl,
      size: 3,
    };
  }

  async fetchProfilePictureUrl(_instance: string, jid: string) {
    this.avatarLookups.push(jid);
    return this.avatarUrl;
  }

  readonly contactLookups: string[] = [];
  addressBook: { jid: string; name: string | null; avatarUrl: string | null }[] = [];

  async findContacts(instanceName: string) {
    this.contactLookups.push(instanceName);
    return this.addressBook;
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
    evolution.sentMedia.length = 0;
    evolution.sentAudio.length = 0;
    evolution.created.length = 0;
    evolution.webhooks.length = 0;
    evolution.groupLookups.length = 0;
    evolution.avatarLookups.length = 0;
    evolution.contactLookups.length = 0;
    evolution.addressBook = [];
    evolution.createInstanceError = undefined;
    evolution.mediaBase64 = undefined;
    evolution.mediaError = undefined;
    evolution.mediaMimeType = undefined;
    evolution.mediaFileName = undefined;
    evolution.mediaSize = undefined;
    evolution.groupSubject = 'Grupo Teste';
    evolution.groupPictureUrl = 'https://cdn.example/group.jpg';
    evolution.avatarUrl = 'https://cdn.example/avatar.jpg';
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

  function imagePayload(
    instanceName: string,
    messageId: string,
    caption: string | null = null,
    remoteJid = '5511999999999@s.whatsapp.net',
  ) {
    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: { remoteJid, fromMe: false, id: messageId },
        pushName: 'Contato Teste',
        message: { imageMessage: { mimetype: 'image/png', caption } },
      },
    };
  }

  function stickerPayload(
    instanceName: string,
    messageId: string,
    remoteJid = '5511999999999@s.whatsapp.net',
  ) {
    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: { remoteJid, fromMe: false, id: messageId },
        pushName: 'Contato Teste',
        message: { stickerMessage: { mimetype: 'image/webp', isAnimated: false } },
      },
    };
  }

  function audioPayload(
    instanceName: string,
    messageId: string,
    remoteJid = '5511999999999@s.whatsapp.net',
  ) {
    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: { remoteJid, fromMe: false, id: messageId },
        pushName: 'Contato Teste',
        message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } },
      },
    };
  }

  function groupPayload(
    instanceName: string,
    messageId: string,
    text: string,
    groupJid = '120363000000000000@g.us',
    participant = '5511888888888@s.whatsapp.net',
    pushName = 'Maria',
  ) {
    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: { remoteJid: groupJid, fromMe: false, id: messageId, participant },
        pushName,
        message: { conversation: text },
      },
    };
  }

  function groupUpsertPayload(instanceName: string, groupJid: string, subject: string) {
    return {
      event: 'groups.upsert',
      instance: instanceName,
      data: {
        id: groupJid,
        subject,
        pictureUrl: 'https://cdn.example/updated.jpg',
      },
    };
  }

  function reactionPayload(
    instanceName: string,
    messageId: string,
    emoji: string,
    options: {
      remoteJid?: string;
      participant?: string;
      participantAlt?: string;
      pushName?: string;
      targetId?: string;
      targetFromMe?: boolean;
    } = {},
  ) {
    const {
      remoteJid = '5511999999999@s.whatsapp.net',
      participant,
      participantAlt,
      pushName = 'Contato Teste',
      targetId = randomUUID(),
      targetFromMe = false,
    } = options;

    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: {
          remoteJid,
          fromMe: false,
          id: messageId,
          ...(participant ? { participant } : {}),
          ...(participantAlt ? { participantAlt } : {}),
        },
        pushName,
        message: {
          reactionMessage: {
            key: {
              id: targetId,
              fromMe: targetFromMe,
              remoteJid,
              ...(participant ? { participant } : {}),
            },
            text: emoji,
          },
        },
      },
    };
  }

  function postWebhook(
    payload: object,
    token = process.env.EVOLUTION_WEBHOOK_SECRET ?? 'test-webhook-secret',
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/webhooks/evolution?token=${token}`,
      payload,
    });
  }

  function buildMultipart(
    file: Buffer,
    fileName: string,
    mimeType: string,
    caption?: string,
  ): { payload: Buffer; contentType: string } {
    const boundary = `----orderup${randomUUID()}`;
    const chunks: Buffer[] = [];
    if (caption) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`,
        ),
      );
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
    );
    chunks.push(file);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    return {
      payload: Buffer.concat(chunks),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
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
      expect(webhook?.events).toEqual([
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'MESSAGES_EDITED',
        'GROUPS_UPSERT',
        'PRESENCE_UPDATE',
      ]);
      expect(webhook?.url).toContain('/api/webhooks/evolution?token=');
      expect(JSON.stringify(response.json())).not.toContain('super-secret-webhook');
    });

    it.each([400, 403, 409])(
      'falls back to an existing Evolution instance when create returns %i',
      async (status) => {
        const instanceName = `existing-${randomUUID()}`;
        const instanceId = await createInstance(ownerA, instanceName);
        evolution.createInstanceError = { status };

        const response = await app.inject({
          method: 'POST',
          url: `/api/whatsapp/instances/${instanceId}/connect`,
          headers: authHeaders(ownerA),
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().code).toBe('2@existing');
        expect(evolution.created).not.toContain(instanceName);
      },
    );

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

  describe('contact sync', () => {
    async function connectAndSync(tenant: SeededTenant, instanceName: string) {
      const instanceId = await createInstance(tenant, instanceName);
      const response = await app.inject({
        method: 'GET',
        url: `/api/whatsapp/instances/${instanceId}/status`,
        headers: authHeaders(tenant),
      });
      return { instanceId, response };
    }

    it('imports the address book automatically when the instance connects', async () => {
      const instanceName = `sync-${randomUUID()}`;
      evolution.addressBook = [
        { jid: '5511911111111@s.whatsapp.net', name: 'Alice', avatarUrl: 'https://cdn.example/alice.jpg' },
        { jid: '5511922222222@s.whatsapp.net', name: 'Bruno', avatarUrl: null },
      ];

      const { response } = await connectAndSync(ownerA, instanceName);

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('CONNECTED');
      expect(evolution.contactLookups).toContain(instanceName);

      const contacts = await prisma.contact.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { phone: 'asc' },
      });
      expect(contacts).toHaveLength(2);
      expect(contacts[0]).toMatchObject({
        phone: '5511911111111',
        name: 'Alice',
        avatarUrl: 'https://cdn.example/alice.jpg',
      });
      expect(contacts[1]).toMatchObject({ phone: '5511922222222', name: 'Bruno' });
    });

    it('keeps a manually edited name and only fills missing data', async () => {
      const phone = '5511933333333';
      await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, phone, name: 'Nome Editado' },
      });
      evolution.addressBook = [
        { jid: `${phone}@s.whatsapp.net`, name: 'Nome WhatsApp', avatarUrl: 'https://cdn.example/x.jpg' },
      ];

      await connectAndSync(ownerA, `sync-keep-${randomUUID()}`);

      const contact = await prisma.contact.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, phone },
      });
      expect(contact.name).toBe('Nome Editado');
      expect(contact.avatarUrl).toBe('https://cdn.example/x.jpg');
    });

    it('replaces a phone placeholder name with the WhatsApp name', async () => {
      const phone = '5511944444444';
      await prisma.contact.create({ data: { tenantId: ownerA.tenantId, phone, name: phone } });
      evolution.addressBook = [
        { jid: `${phone}@s.whatsapp.net`, name: 'Nome Real', avatarUrl: null },
      ];

      await connectAndSync(ownerA, `sync-name-${randomUUID()}`);

      const contact = await prisma.contact.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, phone },
      });
      expect(contact.name).toBe('Nome Real');
    });

    it('ignores groups, status and invalid identifiers', async () => {
      evolution.addressBook = [
        { jid: '120363000000000000@g.us', name: 'Grupo', avatarUrl: null },
        { jid: 'status@broadcast', name: 'Status', avatarUrl: null },
        { jid: 'abc@lid', name: 'Lid', avatarUrl: null },
        { jid: '75209205874877@lid', name: 'Lid Numérico', avatarUrl: null },
        { jid: '867051314767696@bot', name: 'Meta AI', avatarUrl: null },
        { jid: '120363410064967646@newsletter', name: 'Newsletter', avatarUrl: null },
        { jid: '5511955555555@s.whatsapp.net', name: 'Válido', avatarUrl: null },
      ];

      await connectAndSync(ownerA, `sync-filter-${randomUUID()}`);

      const contacts = await prisma.contact.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(contacts).toHaveLength(1);
      expect(contacts[0].phone).toBe('5511955555555');
    });

    it('removes orphan contacts left by a previous bad import and reimports them', async () => {
      await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, phone: '669880924186', name: 'Mãe' },
      });
      evolution.addressBook = [
        { jid: '5511988888888@s.whatsapp.net', name: 'Mãe', avatarUrl: null },
      ];

      await connectAndSync(ownerA, `sync-heal-${randomUUID()}`);

      const contacts = await prisma.contact.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { phone: 'asc' },
      });
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ phone: '5511988888888', name: 'Mãe' });
    });

    it('never imports contacts into another tenant', async () => {
      evolution.addressBook = [
        { jid: '5511966666666@s.whatsapp.net', name: 'Isolado', avatarUrl: null },
      ];

      await connectAndSync(ownerA, `sync-iso-${randomUUID()}`);

      const contacts = await prisma.contact.findMany({ where: { tenantId: ownerB.tenantId } });
      expect(contacts).toHaveLength(0);
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

    it('ignores inbound messages from a blocked contact', async () => {
      const instanceName = `blocked-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, phone: '5511999999999', name: 'Bloqueado', isBlocked: true },
      });

      const response = await postWebhook(evolutionPayload(instanceName, randomUUID(), 'oi'));

      expect(response.statusCode).toBe(200);
      expect(response.json().ignored).toBe('blocked_contact');
      expect(await prisma.conversation.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
    });

    it('accepts inbound messages again after unblocking the contact', async () => {
      const instanceName = `unblocked-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const contact = await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, phone: '5511999999999', name: 'Bloqueado', isBlocked: true },
      });

      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'bloqueado'));
      await prisma.contact.update({ where: { id: contact.id }, data: { isBlocked: false } });

      const response = await postWebhook(evolutionPayload(instanceName, randomUUID(), 'liberado'));

      expect(response.statusCode).toBe(200);
      expect(response.json().conversationId).toBeDefined();
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('publishes inbound message events with their direction', async () => {
      const instanceName = `dir-in-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Cheguei'));

      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'message.created',
        expect.objectContaining({ direction: 'INBOUND' }),
      );
      emit.mockRestore();
    });

    it('captures media wrapped in a view-once message', async () => {
      const instanceName = `view-once-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Contato Teste',
          message: {
            viewOnceMessageV2: {
              message: {
                imageMessage: { mimetype: 'image/jpeg', viewOnce: true, caption: 'olha isso' },
              },
            },
          },
        },
      });

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('IMAGE');
      expect(message.content).toBe('olha isso');
      expect((message.metadata as { viewOnce?: boolean }).viewOnce).toBe(true);
    });

    it('flags a view-once message whose content is withheld by WhatsApp', async () => {
      const instanceName = `view-once-empty-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Contato Teste',
          messageType: 'viewOnceMessageV2',
          message: { viewOnceMessageV2: { message: {} } },
        },
      });

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('UNKNOWN');
      expect((message.metadata as { viewOnce?: boolean }).viewOnce).toBe(true);
    });

    it('detects view-once from the wire messageType without the envelope', async () => {
      const instanceName = `view-once-type-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Contato Teste',
          messageType: 'viewOnceMessageV2',
          message: { imageMessage: { mimetype: 'image/jpeg', viewOnce: true } },
        },
      });

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('IMAGE');
      expect((message.metadata as { viewOnce?: boolean }).viewOnce).toBe(true);
    });

    it('does not download or attach the media of a view-once message', async () => {
      const instanceName = `view-once-skip-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Contato Teste',
          message: {
            viewOnceMessageV2: {
              message: { imageMessage: { mimetype: 'image/jpeg', viewOnce: true } },
            },
          },
        },
      });

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      const metadata = message.metadata as { viewOnce?: boolean; mediaError?: string };
      expect(metadata.viewOnce).toBe(true);
      expect(metadata.mediaError).toBeUndefined();
      expect(await prisma.messageAttachment.count({ where: { messageId: message.id } })).toBe(0);
    });

    it('persists a view-once message from a group keeping the author identity', async () => {
      const instanceName = `view-once-group-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: {
            remoteJid: '120363000000000099@g.us',
            fromMe: false,
            id: randomUUID(),
            participant: '5511888888888@s.whatsapp.net',
          },
          pushName: 'Ana Vilma',
          message: {
            viewOnceMessageV2: {
              message: { videoMessage: { mimetype: 'video/mp4', viewOnce: true } },
            },
          },
        },
      });

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('VIDEO');
      expect(message.senderId).toBe('5511888888888@s.whatsapp.net');
      expect(message.senderName).toBe('Ana Vilma');
      expect((message.metadata as { viewOnce?: boolean }).viewOnce).toBe(true);
    });

    it('does not flag a regular image as view-once', async () => {
      const instanceName = `regular-image-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Contato Teste',
          message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } },
        },
      });

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('IMAGE');
      expect((message.metadata as { viewOnce?: boolean }).viewOnce).toBeUndefined();
    });

    it('does not flag an unknown message as view-once', async () => {
      const instanceName = `unknown-message-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Contato Teste',
          message: { someUnsupportedMessage: { foo: 'bar' } },
        },
      });

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('UNKNOWN');
      expect((message.metadata as { viewOnce?: boolean }).viewOnce).toBeUndefined();
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

  describe('external outbound messages (fromMe)', () => {
    function outboundPayload(
      instanceName: string,
      messageId: string,
      text: string,
      options: { remoteJid?: string; participant?: string; pushName?: string } = {},
    ) {
      const {
        remoteJid = '5511999999999@s.whatsapp.net',
        participant,
        pushName = 'Atendente',
      } = options;
      return {
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: {
            remoteJid,
            fromMe: true,
            id: messageId,
            ...(participant ? { participant } : {}),
          },
          pushName,
          message: { conversation: text },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      };
    }

    it('syncs a message sent from the phone as OUTBOUND', async () => {
      const instanceName = `out-phone-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      try {
        const response = await postWebhook(
          outboundPayload(instanceName, randomUUID(), 'Enviado do celular'),
        );

        expect(response.statusCode).toBe(200);
        expect(response.json().accepted).toBe(true);

        const conversations = await prisma.conversation.findMany({
          where: { tenantId: ownerA.tenantId },
        });
        expect(conversations).toHaveLength(1);
        expect(conversations[0].contactId).not.toBeNull();
        expect(conversations[0].lastMessageAt).not.toBeNull();

        const contact = await prisma.contact.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId },
        });
        expect(contact.phone).toBe('5511999999999');

        const message = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId },
        });
        expect(message.direction).toBe('OUTBOUND');
        expect(message.status).toBe('SENT');
        expect(message.content).toBe('Enviado do celular');

        expect(emit).toHaveBeenCalledWith(
          ownerA.tenantId,
          'message.created',
          expect.objectContaining({ direction: 'OUTBOUND', messageId: message.id }),
        );

        // Visible through the same API the attendance screen reads from.
        const listed = await app.inject({
          method: 'GET',
          url: `/api/conversations/${conversations[0].id}/messages`,
          headers: authHeaders(ownerA),
        });
        expect(listed.statusCode).toBe(200);
        expect(listed.json().data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: message.id, direction: 'OUTBOUND' }),
          ]),
        );

        const inbox = await app.inject({
          method: 'GET',
          url: '/api/conversations',
          headers: authHeaders(ownerA),
        });
        expect(inbox.json().data[0].lastMessage).toMatchObject({
          content: 'Enviado do celular',
          direction: 'OUTBOUND',
        });
        expect(inbox.json().data[0].unreadCount).toBe(0);
      } finally {
        emit.mockRestore();
      }
    });

    it('syncs a message sent from WhatsApp Web and reuses the same conversation', async () => {
      const instanceName = `out-web-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook(outboundPayload(instanceName, randomUUID(), 'Primeira do Web'));
      await postWebhook(outboundPayload(instanceName, randomUUID(), 'Segunda do Web'));

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);

      const contacts = await prisma.contact.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(contacts).toHaveLength(1);

      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { createdAt: 'asc' },
      });
      expect(messages).toHaveLength(2);
      expect(messages.every((message) => message.direction === 'OUTBOUND')).toBe(true);
      expect(messages.map((message) => message.content)).toEqual([
        'Primeira do Web',
        'Segunda do Web',
      ]);
    });

    it('keeps distinct messages with the same content (dedup by provider id)', async () => {
      const instanceName = `out-distinct-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook(outboundPayload(instanceName, randomUUID(), 'ok'));
      await postWebhook(outboundPayload(instanceName, randomUUID(), 'ok'));

      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(2);
    });

    it('is idempotent for a repeated external event', async () => {
      const instanceName = `out-repeat-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const payload = outboundPayload(instanceName, randomUUID(), 'Enviada uma vez');

      await postWebhook(payload);
      const second = await postWebhook(payload);

      expect(second.json().ignored).toBe('duplicate_event');
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('reconciles an external event for a message already sent by the CRM', async () => {
      const instanceName = `out-crm-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Resposta enviada pelo CRM' },
      });

      const outbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'OUTBOUND' },
      });
      expect(outbound.externalMessageId).toBeTruthy();
      const total = await prisma.message.count({ where: { tenantId: ownerA.tenantId } });

      const response = await postWebhook(
        outboundPayload(instanceName, outbound.externalMessageId as string, 'Resposta enviada pelo CRM'),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json().ignored).toBe('reconciled_message');
      expect(response.json().messageId).toBe(outbound.id);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(total);
    });

    it('syncs a group message sent from the phone without creating a contact', async () => {
      const instanceName = `out-group-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const groupJid = '120363333333333333@g.us';

      const response = await postWebhook(
        outboundPayload(instanceName, randomUUID(), 'Mensagem no grupo', { remoteJid: groupJid }),
      );

      expect(response.json().accepted).toBe(true);
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.isGroup).toBe(true);
      expect(conversation.externalContactId).toBe(groupJid);
      expect(conversation.groupName).toBe('Grupo Teste');
      expect(conversation.contactId).toBeNull();
      expect(await prisma.contact.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(message.direction).toBe('OUTBOUND');
      expect(message.senderId).toBeNull();
    });

    it('acknowledges without persisting when no remote JID is present', async () => {
      const instanceName = `out-nojid-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const response = await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: { key: { fromMe: true, id: randomUUID() }, message: { conversation: 'x' } },
      });

      expect(response.json().ignored).toBe('missing_contact');
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
      expect(await prisma.conversation.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
    });

    it('stores a fromMe message addressed by a LID without inventing a contact', async () => {
      const instanceName = `out-lid-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const lid = '75209205874877@lid';

      const response = await postWebhook(
        outboundPayload(instanceName, randomUUID(), 'Enviada para um LID', { remoteJid: lid }),
      );

      expect(response.json().accepted).toBe(true);
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.externalContactId).toBe(lid);
      expect(conversation.contactId).toBeNull();
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('downloads media sent from the phone with fromMe=true', async () => {
      const instanceName = `out-media-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const image = await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .png()
        .toBuffer();
      evolution.mediaBase64 = image.toString('base64');
      evolution.mediaMimeType = 'image/png';
      const spy = vi.spyOn(evolution, 'getBase64FromMediaMessage');

      try {
        await postWebhook({
          event: 'messages.upsert',
          instance: instanceName,
          data: {
            key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, id: randomUUID() },
            message: { imageMessage: { mimetype: 'image/png', caption: 'Foto do celular' } },
          },
        });

        expect(spy).toHaveBeenCalledWith(
          instanceName,
          expect.objectContaining({ fromMe: true }),
        );
        const message = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId },
        });
        expect(message.type).toBe('IMAGE');
        expect(message.direction).toBe('OUTBOUND');
        expect(
          await prisma.messageAttachment.count({ where: { messageId: message.id } }),
        ).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('never writes external outbound messages into another tenant', async () => {
      const instanceName = `out-iso-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await createInstance(ownerB, `out-iso-b-${randomUUID()}`);

      await postWebhook(outboundPayload(instanceName, randomUUID(), 'Só do tenant A'));

      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(await prisma.message.count({ where: { tenantId: ownerB.tenantId } })).toBe(0);
      expect(await prisma.conversation.count({ where: { tenantId: ownerB.tenantId } })).toBe(0);
    });
  });

  describe('message status receipts', () => {
    async function seedOutbound(): Promise<{
      instanceName: string;
      conversationId: string;
      messageId: string;
      externalMessageId: string;
    }> {
      const instanceName = `status-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Boa tarde, Jackson' },
      });

      const outbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'OUTBOUND' },
      });
      return {
        instanceName,
        conversationId: conversation.id,
        messageId: outbound.id,
        externalMessageId: outbound.externalMessageId as string,
      };
    }

    function statusPayload(instanceName: string, keyId: string, status: string) {
      return {
        event: 'messages.update',
        instance: instanceName,
        data: {
          keyId,
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: true,
          status,
        },
      };
    }

    it('advances an outbound message from SENT to DELIVERED and READ', async () => {
      const { instanceName, messageId, conversationId, externalMessageId } = await seedOutbound();
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToConversation');

      await postWebhook(statusPayload(instanceName, externalMessageId, 'SERVER_ACK'));
      let message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('SENT');

      await postWebhook(statusPayload(instanceName, externalMessageId, 'DELIVERY_ACK'));
      message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('DELIVERED');
      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        conversationId,
        'message.updated',
        expect.objectContaining({ messageId, status: 'DELIVERED' }),
      );

      await postWebhook(statusPayload(instanceName, externalMessageId, 'READ'));
      message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('READ');

      emit.mockRestore();
    });

    it('never downgrades a status when receipts arrive out of order', async () => {
      const { instanceName, messageId, externalMessageId } = await seedOutbound();

      await postWebhook(statusPayload(instanceName, externalMessageId, 'READ'));
      await postWebhook(statusPayload(instanceName, externalMessageId, 'DELIVERY_ACK'));
      await postWebhook(statusPayload(instanceName, externalMessageId, 'SERVER_ACK'));

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('READ');
    });

    it('ignores receipts for unknown messages without failing the webhook', async () => {
      const { instanceName } = await seedOutbound();

      const response = await postWebhook(statusPayload(instanceName, randomUUID(), 'DELIVERY_ACK'));

      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);
    });

    it('scopes status updates to the owning tenant', async () => {
      const { messageId, externalMessageId } = await seedOutbound();
      const foreignInstance = `status-b-${randomUUID()}`;
      await createInstance(ownerB, foreignInstance);

      await postWebhook(statusPayload(foreignInstance, externalMessageId, 'READ'));

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('SENT');
    });
  });

  describe('message edits', () => {
    const remoteJid = '5511999999999@s.whatsapp.net';

    async function seedConversation(): Promise<{ instanceName: string }> {
      const instanceName = `edit-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Mensagem original'));
      return { instanceName };
    }

    function editedEvent(instanceName: string, originalId: string, text: string, fromMe = false) {
      return {
        event: 'messages.edited',
        instance: instanceName,
        data: {
          key: { remoteJid, fromMe, id: originalId },
          type: 14,
          editedMessage: { conversation: text },
        },
      };
    }

    function editedUpdate(instanceName: string, originalId: string, text: string) {
      return {
        event: 'messages.update',
        instance: instanceName,
        data: [
          {
            keyId: originalId,
            remoteJid,
            fromMe: true,
            status: 'SERVER_ACK',
            message: { editedMessage: { message: { conversation: text } } },
          },
        ],
      };
    }

    function editedUpsert(
      instanceName: string,
      editId: string,
      originalId: string,
      text: string,
    ) {
      return {
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid, fromMe: false, id: editId },
          pushName: 'Contato Teste',
          message: {
            protocolMessage: {
              key: { remoteJid, fromMe: false, id: originalId },
              type: 14,
              editedMessage: { conversation: text },
            },
          },
        },
      };
    }

    function outboundFromPhone(instanceName: string, messageId: string, text: string) {
      return {
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid, fromMe: true, id: messageId },
          pushName: 'Atendente',
          message: { conversation: text },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      };
    }

    it('updates an inbound message edited by the participant', async () => {
      const { instanceName } = await seedConversation();
      const original = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToConversation');

      const response = await postWebhook(
        editedEvent(instanceName, original.externalMessageId as string, 'Mensagem editada'),
      );

      expect(response.statusCode).toBe(200);
      const updated = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
      expect(updated.content).toBe('Mensagem editada');
      expect(updated.type).toBe('TEXT');
      expect((updated.metadata as Record<string, unknown>).edited).toBe(true);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        original.conversationId,
        'message.updated',
        expect.objectContaining({ messageId: original.id }),
      );
      emit.mockRestore();
    });

    it('updates an outbound message sent from the phone', async () => {
      const instanceName = `edit-out-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const externalId = randomUUID();
      await postWebhook(outboundFromPhone(instanceName, externalId, 'Enviada do celular'));
      const original = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      await postWebhook(editedUpdate(instanceName, externalId, 'Corrigida do celular'));

      const updated = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
      expect(updated.content).toBe('Corrigida do celular');
      expect(updated.direction).toBe('OUTBOUND');
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('applies an edit delivered as messages.upsert without creating a spurious message', async () => {
      const { instanceName } = await seedConversation();
      const original = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const response = await postWebhook(
        editedUpsert(
          instanceName,
          randomUUID(),
          original.externalMessageId as string,
          'Editada via upsert',
        ),
      );

      expect(response.statusCode).toBe(200);
      const updated = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
      expect(updated.content).toBe('Editada via upsert');
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(
        await prisma.message.count({ where: { tenantId: ownerA.tenantId, type: 'UNKNOWN' } }),
      ).toBe(0);
    });

    it('is idempotent for a repeated edit and still applies a later edit', async () => {
      const { instanceName } = await seedConversation();
      const original = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const externalId = original.externalMessageId as string;

      const first = editedEvent(instanceName, externalId, 'Primeira edição');
      await postWebhook(first);
      const duplicate = await postWebhook(first);
      expect(duplicate.json().ignored).toBe('duplicate_event');

      await postWebhook(editedEvent(instanceName, externalId, 'Segunda edição'));

      const updated = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
      expect(updated.content).toBe('Segunda edição');
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('ignores an edit without the original message id', async () => {
      const { instanceName } = await seedConversation();

      const response = await postWebhook({
        event: 'messages.edited',
        instance: instanceName,
        data: { type: 14, editedMessage: { conversation: 'sem alvo' } },
      });

      expect(response.statusCode).toBe(200);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('ignores an edit received before the original without inventing a message', async () => {
      const instanceName = `edit-early-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const response = await postWebhook(editedEvent(instanceName, randomUUID(), 'Editada cedo'));

      expect(response.statusCode).toBe(200);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
    });

    it('never edits a message from another tenant', async () => {
      await seedConversation();
      const original = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const foreignInstance = `edit-b-${randomUUID()}`;
      await createInstance(ownerB, foreignInstance);

      const response = await postWebhook(
        editedEvent(foreignInstance, original.externalMessageId as string, 'Ataque'),
      );

      expect(response.statusCode).toBe(200);
      const unchanged = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
      expect(unchanged.content).toBe('Mensagem original');
    });
  });

  describe('groups', () => {
    const groupJid = '120363111111111111@g.us';
    const participant = '5511888888888@s.whatsapp.net';

    it('creates a group conversation with name, avatar and message sender', async () => {
      const instanceName = `group-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const response = await postWebhook(
        groupPayload(instanceName, randomUUID(), 'Bom dia pessoal', groupJid, participant, 'Maria'),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.isGroup).toBe(true);
      expect(conversation.groupName).toBe('Grupo Teste');
      expect(conversation.avatarUrl).toBe('https://cdn.example/group.jpg');
      expect(conversation.contactId).toBeNull();
      expect(conversation.externalContactId).toBe(groupJid);

      const contacts = await prisma.contact.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(contacts).toHaveLength(0);

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(message.senderId).toBe(participant);
      expect(message.senderName).toBe('Maria');
      expect(evolution.groupLookups).toContain(groupJid);
    });

    it('reuses the group conversation and does not re-fetch its name', async () => {
      const instanceName = `group-reuse-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook(
        groupPayload(instanceName, randomUUID(), 'Primeira', groupJid, participant),
      );
      await postWebhook(groupPayload(instanceName, randomUUID(), 'Segunda', groupJid, participant));

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);
      expect(evolution.groupLookups).toHaveLength(1);
    });

    it('updates the group name and avatar from the groups webhook', async () => {
      const instanceName = `group-upsert-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(groupPayload(instanceName, randomUUID(), 'Olá', groupJid, participant));

      const response = await postWebhook(
        groupUpsertPayload(instanceName, groupJid, 'Grupo Renomeado'),
      );
      expect(response.statusCode).toBe(200);

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.groupName).toBe('Grupo Renomeado');
      expect(conversation.avatarUrl).toBe('https://cdn.example/updated.jpg');
    });

    it('refreshes an existing group conversation on demand', async () => {
      const instanceName = `group-refresh-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(groupPayload(instanceName, randomUUID(), 'Olá', groupJid, participant));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      evolution.groupSubject = 'Nome Atualizado';

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/refresh-group`,
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().groupName).toBe('Nome Atualizado');

      const refreshed = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(refreshed.groupName).toBe('Nome Atualizado');
      expect(refreshed.isGroup).toBe(true);
    });

    it('rejects refreshing a conversation that is not a group', async () => {
      const instanceName = `group-invalid-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Oi'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/refresh-group`,
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('NOT_A_GROUP');
    });

    it('sends a reply to the full group JID', async () => {
      const instanceName = `group-send-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(groupPayload(instanceName, randomUUID(), 'Olá', groupJid, participant));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const sent = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Respondendo no grupo' },
      });
      expect(sent.statusCode).toBe(201);
      expect(evolution.sent).toHaveLength(1);
      expect(evolution.sent[0].number).toBe(groupJid);
    });

    it('resolves a participant avatar only inside the owning tenant', async () => {
      const instanceName = `group-avatar-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(groupPayload(instanceName, randomUUID(), 'Olá', groupJid, participant));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const url = `/api/conversations/${conversation.id}/participant-avatar?jid=${encodeURIComponent(participant)}`;

      const owned = await app.inject({ method: 'GET', url, headers: authHeaders(ownerA) });
      expect(owned.statusCode).toBe(200);
      expect(owned.json().url).toBe('https://cdn.example/avatar.jpg');

      const foreign = await app.inject({ method: 'GET', url, headers: authHeaders(ownerB) });
      expect(foreign.statusCode).toBe(404);

      const unknown = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversation.id}/participant-avatar?jid=${encodeURIComponent('5599999999999@s.whatsapp.net')}`,
        headers: authHeaders(ownerA),
      });
      expect(unknown.statusCode).toBe(404);
    });
  });

  describe('reactions', () => {
    it('attributes a group reaction to its participant instead of leaving it unknown', async () => {
      const instanceName = `reaction-group-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const groupJid = '120363222222222222@g.us';
      const participant = '5511888888888@lid';
      const participantAlt = '5511888888888@s.whatsapp.net';
      const targetId = randomUUID();

      const response = await postWebhook(
        reactionPayload(instanceName, randomUUID(), '😂', {
          remoteJid: groupJid,
          participant,
          participantAlt,
          pushName: 'Maria',
          targetId,
          targetFromMe: true,
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('REACTION');
      expect(message.content).toBe('😂');
      expect(message.senderName).toBe('Maria');
      expect(message.senderId).toBe(participant);
      expect(message.metadata).toMatchObject({
        reaction: { targetMessageId: targetId, targetFromMe: true },
      });
    });

    it('attributes an individual reaction to the contact', async () => {
      const instanceName = `reaction-direct-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();

      await postWebhook(
        reactionPayload(instanceName, randomUUID(), '❤️', {
          remoteJid: '5511999999999@s.whatsapp.net',
          pushName: 'Contato Teste',
          targetId,
          targetFromMe: true,
        }),
      );

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(message.type).toBe('REACTION');
      expect(message.content).toBe('❤️');
      expect(message.senderName).toBe('Contato Teste');
      expect(message.senderId).toBe('5511999999999@s.whatsapp.net');
      expect(message.metadata).toMatchObject({ reaction: { targetMessageId: targetId } });
    });

    it('does not leave an unknown message when the reaction is removed', async () => {
      const instanceName = `reaction-remove-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const response = await postWebhook(
        reactionPayload(instanceName, randomUUID(), '', {
          remoteJid: '5511999999999@s.whatsapp.net',
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json().ignored).toBe('reaction_removed');

      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(messages).toHaveLength(0);
    });
  });

  it('relays repeated presence transitions only to the owning tenant without persisting events', async () => {
    const instanceName = `presence-${randomUUID()}`;
    const jid = '5511999999999@s.whatsapp.net';
    await createInstance(ownerA, instanceName);
    await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá', jid));
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');
    try {
      for (const state of ['composing', 'paused', 'composing', 'recording', 'unavailable']) {
        const response = await postWebhook({
          event: 'presence.update',
          instance: instanceName,
          data: { id: jid, presences: { [jid]: { lastKnownPresence: state } } },
        });
        expect(response.statusCode).toBe(200);
        expect(emit).toHaveBeenLastCalledWith(ownerA.tenantId, 'conversation.presence', {
          conversationId: conversation.id,
          participantId: jid,
          state,
        });
      }
      expect(emit).toHaveBeenCalledTimes(5);
      await postWebhook({
        event: 'presence.update',
        instance: instanceName,
        data: {
          id: 'unknown@s.whatsapp.net',
          presences: { [jid]: { lastKnownPresence: 'composing' } },
        },
      });
      await postWebhook({
        event: 'presence.update',
        instance: instanceName,
        data: { id: jid, presences: null },
      });
      expect(emit).toHaveBeenCalledTimes(5);
      expect(
        await prisma.webhookEvent.count({
          where: { tenantId: ownerA.tenantId, eventType: 'presence.update' },
        }),
      ).toBe(0);
    } finally {
      emit.mockRestore();
    }
  });

  it('resolves direct contact photos with caching and tenant isolation', async () => {
    const instanceName = `contact-avatar-${randomUUID()}`;
    const jid = '5511999999999@s.whatsapp.net';
    await createInstance(ownerA, instanceName);
    await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá', jid));
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    const url = `/api/conversations/${conversation.id}/participant-avatar?jid=${encodeURIComponent(jid)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({ method: 'GET', url, headers: authHeaders(ownerA) });
      expect(response.statusCode).toBe(200);
      expect(response.json().url).toBe(evolution.avatarUrl);
    }
    expect(evolution.avatarLookups).toEqual([jid]);
    const foreign = await app.inject({ method: 'GET', url, headers: authHeaders(ownerB) });
    expect(foreign.statusCode).toBe(404);
    expect(evolution.avatarLookups).toEqual([jid]);
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

    it('publishes outbound message events with their direction', async () => {
      const { conversationId } = await seedConversation();
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Mensagem do atendente' },
      });

      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'message.created',
        expect.objectContaining({ conversationId, direction: 'OUTBOUND' }),
      );
      emit.mockRestore();
    });

    it('sends to a LID conversation using the full JID', async () => {
      const instanceName = `lid-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'oi', '75209205874877@lid'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.externalContactId).toBe('75209205874877@lid');

      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Olá' },
      });

      expect(evolution.sent).toHaveLength(1);
      expect(evolution.sent[0].number).toBe('75209205874877@lid');
    });

    it('returns the most recent messages first when paginating', async () => {
      const { conversationId } = await seedConversation();
      const base = Date.now();
      await prisma.message.createMany({
        data: [1, 2, 3].map((n) => ({
          tenantId: ownerA.tenantId,
          conversationId,
          direction: 'INBOUND' as const,
          type: 'TEXT' as const,
          content: `msg-${n}`,
          status: 'RECEIVED' as const,
          occurredAt: new Date(base + n * 1000),
        })),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversationId}/messages?page=1&perPage=2`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(200);
      const contents = (response.json().data as { content: string }[]).map((item) => item.content);
      expect(contents).toEqual(['msg-2', 'msg-3']);
    });

    it('filters conversations by WhatsApp instance and by contact', async () => {
      const instanceA = `filter-a-${randomUUID()}`;
      const instanceB = `filter-b-${randomUUID()}`;
      await createInstance(ownerA, instanceA);
      await createInstance(ownerA, instanceB);
      await postWebhook(
        evolutionPayload(instanceA, randomUUID(), 'a', '5511888888888@s.whatsapp.net'),
      );
      await postWebhook(
        evolutionPayload(instanceB, randomUUID(), 'b', '5511777777777@s.whatsapp.net'),
      );

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

  describe('media', () => {
    async function seedConversation(): Promise<string> {
      const instanceName = `media-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá'));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      return conversation.id;
    }

    it('optimizes and stores an inbound image with a thumbnail', async () => {
      const instanceName = `in-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const original = await sharp({
        create: { width: 2400, height: 1200, channels: 3, background: '#3366ff' },
      })
        .png()
        .toBuffer();
      evolution.mediaBase64 = original.toString('base64');

      const response = await postWebhook(imagePayload(instanceName, randomUUID(), 'minha legenda'));
      expect(response.statusCode).toBe(200);

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, type: 'IMAGE' },
      });
      expect(message.content).toBe('minha legenda');

      const attachment = await prisma.messageAttachment.findFirstOrThrow({
        where: { messageId: message.id },
      });
      expect(attachment.mimeType).toBe('image/jpeg');
      expect(attachment.size).toBeLessThan(original.length);

      const metadata = attachment.metadata as { width?: number; thumbnailKey?: string };
      expect(metadata.width ?? 0).toBeLessThanOrEqual(1600);
      expect(metadata.thumbnailKey).toBeDefined();

      const baseDir = process.env.STORAGE_LOCAL_DIR as string;
      const stored = await readFile(join(baseDir, attachment.storageKey));
      expect(stored.length).toBe(attachment.size);
      const thumb = await readFile(join(baseDir, metadata.thumbnailKey as string));
      expect(thumb.length).toBeGreaterThan(0);
    });

    it('marks the message when inbound media cannot be retrieved', async () => {
      const instanceName = `in-fail-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      evolution.mediaError = { status: 404 };

      await postWebhook(imagePayload(instanceName, randomUUID()));

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, type: 'IMAGE' },
      });
      expect((message.metadata as { mediaError?: string }).mediaError).toBe('fetch_failed');
      const attachments = await prisma.messageAttachment.count({
        where: { messageId: message.id },
      });
      expect(attachments).toBe(0);
    });

    it('sends an uploaded image reduced and marks it as sent', async () => {
      const conversationId = await seedConversation();
      const file = await sharp({
        create: { width: 2000, height: 1000, channels: 3, background: '#ff0000' },
      })
        .png()
        .toBuffer();
      const { payload, contentType } = buildMultipart(
        file,
        'foto.png',
        'image/png',
        'legenda da foto',
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/messages/media`,
        headers: { ...authHeaders(ownerA), 'content-type': contentType },
        payload,
      });

      expect(response.statusCode).toBe(201);
      expect(evolution.sentMedia).toHaveLength(1);
      expect(evolution.sentMedia[0].mediatype).toBe('image');
      expect(evolution.sentMedia[0].caption).toBe('legenda da foto');

      const outbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, conversationId, direction: 'OUTBOUND', type: 'IMAGE' },
      });
      expect(outbound.status).toBe('SENT');
      expect(outbound.content).toBe('legenda da foto');

      const attachment = await prisma.messageAttachment.findFirstOrThrow({
        where: { messageId: outbound.id },
      });
      expect(attachment.mimeType).toBe('image/jpeg');
      expect(attachment.size).toBeLessThan(file.length);
    });

    it('serves attachments only to the owning tenant', async () => {
      const instanceName = `dl-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const original = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#00ff00' },
      })
        .png()
        .toBuffer();
      evolution.mediaBase64 = original.toString('base64');

      await postWebhook(imagePayload(instanceName, randomUUID()));

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, type: 'IMAGE' },
      });
      const attachment = await prisma.messageAttachment.findFirstOrThrow({
        where: { messageId: message.id },
      });

      const url = `/api/conversations/${message.conversationId}/messages/${message.id}/attachments/${attachment.id}`;

      const owned = await app.inject({ method: 'GET', url, headers: authHeaders(ownerA) });
      expect(owned.statusCode).toBe(200);
      expect(owned.headers['content-type']).toBe('image/jpeg');

      const foreign = await app.inject({ method: 'GET', url, headers: authHeaders(ownerB) });
      expect(foreign.statusCode).toBe(404);
    });

    it('stores an inbound sticker as webp without converting', async () => {
      const instanceName = `sticker-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const sticker = await sharp({
        create: {
          width: 512,
          height: 512,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0 },
        },
      })
        .webp()
        .toBuffer();
      evolution.mediaBase64 = sticker.toString('base64');
      evolution.mediaMimeType = 'image/webp';
      evolution.mediaFileName = 'sticker.webp';

      await postWebhook(stickerPayload(instanceName, randomUUID()));

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, type: 'STICKER' },
      });
      const attachment = await prisma.messageAttachment.findFirstOrThrow({
        where: { messageId: message.id },
      });
      expect(attachment.mimeType).toBe('image/webp');
      expect(attachment.storageKey.endsWith('.webp')).toBe(true);
    });

    it('stores an inbound audio message', async () => {
      const instanceName = `audio-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      evolution.mediaBase64 = Buffer.from('OggS-fake-audio-content').toString('base64');
      evolution.mediaMimeType = 'audio/ogg; codecs=opus';
      evolution.mediaFileName = null;

      await postWebhook(audioPayload(instanceName, randomUUID()));

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, type: 'AUDIO' },
      });
      const attachment = await prisma.messageAttachment.findFirstOrThrow({
        where: { messageId: message.id },
      });
      expect(attachment.mimeType).toContain('audio/ogg');
      expect(attachment.storageKey.endsWith('.ogg')).toBe(true);
    });

    it('marks inbound media larger than the limit', async () => {
      const instanceName = `big-in-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      evolution.mediaBase64 = Buffer.from('x').toString('base64');
      evolution.mediaSize = Number(process.env.MEDIA_MAX_BYTES) + 1000;

      await postWebhook(imagePayload(instanceName, randomUUID()));

      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, type: 'IMAGE' },
      });
      expect((message.metadata as { mediaError?: string }).mediaError).toBe('too_large');
      const attachments = await prisma.messageAttachment.count({
        where: { messageId: message.id },
      });
      expect(attachments).toBe(0);
    });

    it('sends an uploaded audio file', async () => {
      const conversationId = await seedConversation();
      const audio = Buffer.from(`OggS${'0'.repeat(200)}`);
      const { payload, contentType } = buildMultipart(audio, 'recado.ogg', 'audio/ogg');

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/messages/media`,
        headers: { ...authHeaders(ownerA), 'content-type': contentType },
        payload,
      });

      expect(response.statusCode).toBe(201);
      expect(evolution.sentAudio).toHaveLength(1);
      expect(evolution.sentMedia).toHaveLength(0);

      const outbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, conversationId, direction: 'OUTBOUND', type: 'AUDIO' },
      });
      expect(outbound.status).toBe('SENT');
    });

    it('rejects an upload larger than the limit', async () => {
      const conversationId = await seedConversation();
      const max = Number(process.env.MEDIA_MAX_BYTES);
      const { payload, contentType } = buildMultipart(
        Buffer.alloc(max + 1024, 1),
        'grande.bin',
        'application/octet-stream',
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/messages/media`,
        headers: { ...authHeaders(ownerA), 'content-type': contentType },
        payload,
      });

      expect(response.statusCode).toBe(413);
      expect(response.json().code).toBe('MEDIA_TOO_LARGE');
      expect(response.json().message).toContain('maior que o permitido');
      expect(evolution.sentMedia).toHaveLength(0);
    });
  });

  describe('pinned conversations and ordering', () => {
    async function seedInstance(tenant: SeededTenant): Promise<string> {
      const instanceName = `pin-${randomUUID()}`;
      await createInstance(tenant, instanceName);
      return instanceName;
    }

    async function createConversation(
      tenant: SeededTenant,
      instanceName: string,
      remoteJid: string,
      options: { lastMessageAt?: Date | null; isPinned?: boolean } = {},
    ): Promise<string> {
      const instance = await prisma.whatsAppInstance.findFirstOrThrow({
        where: { tenantId: tenant.tenantId, instanceName },
        select: { id: true },
      });
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: tenant.tenantId,
          whatsappInstanceId: instance.id,
          externalContactId: remoteJid,
          isGroup: false,
          status: 'OPEN',
          isPinned: options.isPinned ?? false,
          ...(options.lastMessageAt !== undefined ? { lastMessageAt: options.lastMessageAt } : {}),
        },
        select: { id: true },
      });
      return conversation.id;
    }

    function listConversations(tenant: SeededTenant, query = '') {
      return app.inject({
        method: 'GET',
        url: `/api/conversations${query}`,
        headers: authHeaders(tenant),
      });
    }

    it('pins and unpins a conversation, persisting the state', async () => {
      const instanceName = await seedInstance(ownerA);
      const conversationId = await createConversation(
        ownerA,
        instanceName,
        '5511900000001@s.whatsapp.net',
      );

      const pinned = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/pin`,
        headers: authHeaders(ownerA),
      });
      expect(pinned.statusCode).toBe(200);
      expect(pinned.json().isPinned).toBe(true);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(stored.isPinned).toBe(true);

      const fetched = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversationId}`,
        headers: authHeaders(ownerA),
      });
      expect(fetched.json().isPinned).toBe(true);

      const unpinned = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/unpin`,
        headers: authHeaders(ownerA),
      });
      expect(unpinned.statusCode).toBe(200);
      expect(unpinned.json().isPinned).toBe(false);

      const storedAfter = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(storedAfter.isPinned).toBe(false);
    });

    it('repeats pin and unpin without inconsistencies', async () => {
      const instanceName = await seedInstance(ownerA);
      const conversationId = await createConversation(
        ownerA,
        instanceName,
        '5511900000002@s.whatsapp.net',
      );

      const first = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/pin`,
        headers: authHeaders(ownerA),
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/pin`,
        headers: authHeaders(ownerA),
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().isPinned).toBe(true);

      const count = await prisma.conversation.count({ where: { id: conversationId } });
      expect(count).toBe(1);

      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/unpin`,
        headers: authHeaders(ownerA),
      });
      const third = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/unpin`,
        headers: authHeaders(ownerA),
      });
      expect(third.statusCode).toBe(200);
      expect(third.json().isPinned).toBe(false);
    });

    it('allows any authenticated member to pin', async () => {
      const instanceName = await seedInstance(ownerA);
      const conversationId = await createConversation(
        ownerA,
        instanceName,
        '5511900000003@s.whatsapp.net',
      );

      const pinned = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/pin`,
        headers: authHeaders(userA),
      });
      expect(pinned.statusCode).toBe(200);
      expect(pinned.json().isPinned).toBe(true);
    });

    it('rejects an unauthenticated pin', async () => {
      const instanceName = await seedInstance(ownerA);
      const conversationId = await createConversation(
        ownerA,
        instanceName,
        '5511900000004@s.whatsapp.net',
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/pin`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for an unknown conversation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${randomUUID()}/pin`,
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('CONVERSATION_NOT_FOUND');
    });

    it('never pins a conversation from another tenant', async () => {
      const instanceName = await seedInstance(ownerA);
      const conversationId = await createConversation(
        ownerA,
        instanceName,
        '5511900000005@s.whatsapp.net',
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/pin`,
        headers: authHeaders(ownerB),
      });
      expect(response.statusCode).toBe(404);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(stored.isPinned).toBe(false);
    });

    it('publishes conversation.updated when the pinned state changes', async () => {
      const instanceName = await seedInstance(ownerA);
      const conversationId = await createConversation(
        ownerA,
        instanceName,
        '5511900000006@s.whatsapp.net',
      );
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/pin`,
        headers: authHeaders(ownerA),
      });

      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'conversation.updated',
        expect.objectContaining({ conversationId }),
      );
      emit.mockRestore();
    });

    it('lists pinned conversations first, then by most recent activity, with nulls last', async () => {
      const instanceName = await seedInstance(ownerA);
      const base = Date.now();
      const pinnedOld = await createConversation(ownerA, instanceName, '5511900000010@s.whatsapp.net', {
        isPinned: true,
        lastMessageAt: new Date(base - 10_000),
      });
      const recent = await createConversation(ownerA, instanceName, '5511900000011@s.whatsapp.net', {
        lastMessageAt: new Date(base),
      });
      const older = await createConversation(ownerA, instanceName, '5511900000012@s.whatsapp.net', {
        lastMessageAt: new Date(base - 20_000),
      });
      const noMessage = await createConversation(ownerA, instanceName, '5511900000013@s.whatsapp.net', {
        lastMessageAt: null,
      });

      const response = await listConversations(ownerA);
      expect(response.statusCode).toBe(200);
      const ids = (response.json().data as { id: string }[]).map((item) => item.id);

      expect(ids[0]).toBe(pinnedOld);
      expect(ids.slice(1)).toEqual([recent, older, noMessage]);
    });

    it('keeps filters and pagination working with pinned conversations', async () => {
      const instanceA = await seedInstance(ownerA);
      const instanceB = await seedInstance(ownerA);
      await createConversation(ownerA, instanceA, '5511900000020@s.whatsapp.net', {
        isPinned: true,
        lastMessageAt: new Date(Date.now() - 1_000),
      });
      await createConversation(ownerA, instanceA, '5511900000021@s.whatsapp.net', {
        lastMessageAt: new Date(Date.now() - 2_000),
      });
      await createConversation(ownerA, instanceA, '5511900000022@s.whatsapp.net', {
        lastMessageAt: new Date(Date.now() - 3_000),
      });
      await createConversation(ownerA, instanceB, '5511900000023@s.whatsapp.net', {
        lastMessageAt: new Date(),
      });

      const instanceAResponse = await listConversations(
        ownerA,
        `?whatsappInstanceId=${await instanceIdOf(ownerA, instanceA)}`,
      );
      expect(instanceAResponse.json().data).toHaveLength(3);

      const firstPage = await listConversations(ownerA, '?perPage=2&page=1');
      expect(firstPage.json().data).toHaveLength(2);
      expect(firstPage.json().meta.total).toBe(4);
      expect(firstPage.json().meta.totalPages).toBe(2);
      expect(firstPage.json().data[0].isPinned).toBe(true);

      const secondPage = await listConversations(ownerA, '?perPage=2&page=2');
      expect(secondPage.json().data).toHaveLength(2);
    });

    async function instanceIdOf(tenant: SeededTenant, instanceName: string): Promise<string> {
      const instance = await prisma.whatsAppInstance.findFirstOrThrow({
        where: { tenantId: tenant.tenantId, instanceName },
        select: { id: true },
      });
      return instance.id;
    }
  });

  describe('archived conversations', () => {
    async function seedInstance(): Promise<string> {
      const instanceName = `archive-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      return instanceName;
    }

    async function createConversation(
      instanceName: string,
      remoteJid: string,
      options: { lastMessageAt?: Date | null; isPinned?: boolean; isArchived?: boolean } = {},
    ): Promise<string> {
      const instance = await prisma.whatsAppInstance.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, instanceName },
        select: { id: true },
      });
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: ownerA.tenantId,
          whatsappInstanceId: instance.id,
          externalContactId: remoteJid,
          isGroup: false,
          status: 'OPEN',
          isPinned: options.isPinned ?? false,
          isArchived: options.isArchived ?? false,
          ...(options.lastMessageAt !== undefined ? { lastMessageAt: options.lastMessageAt } : {}),
        },
        select: { id: true },
      });
      return conversation.id;
    }

    function listConversations(tenant: SeededTenant, query = '') {
      return app.inject({
        method: 'GET',
        url: `/api/conversations${query}`,
        headers: authHeaders(tenant),
      });
    }

    function archive(id: string, tenant = ownerA) {
      return app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/archive`,
        headers: authHeaders(tenant),
      });
    }

    function unarchive(id: string, tenant = ownerA) {
      return app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/unarchive`,
        headers: authHeaders(tenant),
      });
    }

    it('archives and unarchives a conversation, persisting the state', async () => {
      const instanceName = await seedInstance();
      const conversationId = await createConversation(
        instanceName,
        '5511901000001@s.whatsapp.net',
      );

      const archived = await archive(conversationId);
      expect(archived.statusCode).toBe(200);
      expect(archived.json().isArchived).toBe(true);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(stored.isArchived).toBe(true);

      const fetched = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversationId}`,
        headers: authHeaders(ownerA),
      });
      expect(fetched.json().isArchived).toBe(true);

      const restored = await unarchive(conversationId);
      expect(restored.statusCode).toBe(200);
      expect(restored.json().isArchived).toBe(false);

      const storedAfter = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(storedAfter.isArchived).toBe(false);
    });

    it('repeats archive and unarchive without inconsistencies', async () => {
      const instanceName = await seedInstance();
      const conversationId = await createConversation(
        instanceName,
        '5511901000002@s.whatsapp.net',
      );

      const first = await archive(conversationId);
      const second = await archive(conversationId);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().isArchived).toBe(true);

      const count = await prisma.conversation.count({ where: { id: conversationId } });
      expect(count).toBe(1);

      await unarchive(conversationId);
      const third = await unarchive(conversationId);
      expect(third.statusCode).toBe(200);
      expect(third.json().isArchived).toBe(false);
    });

    it('hides archived conversations from the inbox and lists them with the filter', async () => {
      const instanceName = await seedInstance();
      const active = await createConversation(instanceName, '5511901000010@s.whatsapp.net');
      const archived = await createConversation(instanceName, '5511901000011@s.whatsapp.net', {
        isArchived: true,
      });

      const inbox = await listConversations(ownerA);
      expect(inbox.json().data.map((item: { id: string }) => item.id)).toEqual([active]);
      expect(inbox.json().meta.total).toBe(1);

      const archivedList = await listConversations(ownerA, '?archived=true');
      expect(archivedList.json().data.map((item: { id: string }) => item.id)).toEqual([archived]);
      expect(archivedList.json().meta.total).toBe(1);
    });

    it('applies search and pagination to the archived list', async () => {
      const instanceName = await seedInstance();
      await createConversation(instanceName, '5511901000020@s.whatsapp.net', {
        isArchived: true,
        lastMessageAt: new Date(Date.now() - 1_000),
      });
      await createConversation(instanceName, '5511901000021@s.whatsapp.net', {
        isArchived: true,
        lastMessageAt: new Date(Date.now() - 2_000),
      });
      const target = await createConversation(instanceName, '5511901000099@s.whatsapp.net', {
        isArchived: true,
      });

      const searched = await listConversations(ownerA, '?archived=true&search=5511901000099');
      expect(searched.json().data).toHaveLength(1);
      expect(searched.json().data[0].id).toBe(target);

      const firstPage = await listConversations(ownerA, '?archived=true&perPage=2&page=1');
      expect(firstPage.json().data).toHaveLength(2);
      expect(firstPage.json().meta.total).toBe(3);
      expect(firstPage.json().meta.totalPages).toBe(2);

      const secondPage = await listConversations(ownerA, '?archived=true&perPage=2&page=2');
      expect(secondPage.json().data).toHaveLength(1);
    });

    it('keeps the instance filter working in the archived list', async () => {
      const instanceA = await seedInstance();
      const instanceB = await seedInstance();
      await createConversation(instanceA, '5511901000030@s.whatsapp.net', { isArchived: true });
      await createConversation(instanceB, '5511901000031@s.whatsapp.net', { isArchived: true });

      const instance = await prisma.whatsAppInstance.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, instanceName: instanceA },
        select: { id: true },
      });
      const response = await listConversations(
        ownerA,
        `?archived=true&whatsappInstanceId=${instance.id}`,
      );
      expect(response.json().data).toHaveLength(1);
      expect(response.json().meta.total).toBe(1);
    });

    it('preserves the pinned state when archiving', async () => {
      const instanceName = await seedInstance();
      const conversationId = await createConversation(
        instanceName,
        '5511901000040@s.whatsapp.net',
        { isPinned: true },
      );

      const archived = await archive(conversationId);
      expect(archived.json().isArchived).toBe(true);
      expect(archived.json().isPinned).toBe(true);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(stored.isPinned).toBe(true);
      expect(stored.isArchived).toBe(true);
    });

    it('lists pinned archived conversations first, then by recent activity', async () => {
      const instanceName = await seedInstance();
      const base = Date.now();
      const pinnedOld = await createConversation(instanceName, '5511901000050@s.whatsapp.net', {
        isArchived: true,
        isPinned: true,
        lastMessageAt: new Date(base - 10_000),
      });
      const recent = await createConversation(instanceName, '5511901000051@s.whatsapp.net', {
        isArchived: true,
        lastMessageAt: new Date(base),
      });
      const older = await createConversation(instanceName, '5511901000052@s.whatsapp.net', {
        isArchived: true,
        lastMessageAt: new Date(base - 20_000),
      });

      const response = await listConversations(ownerA, '?archived=true');
      const ids = (response.json().data as { id: string }[]).map((item) => item.id);
      expect(ids).toEqual([pinnedOld, recent, older]);
    });

    it('never archives a conversation from another tenant', async () => {
      const instanceName = await seedInstance();
      const conversationId = await createConversation(
        instanceName,
        '5511901000060@s.whatsapp.net',
      );

      const response = await archive(conversationId, ownerB);
      expect(response.statusCode).toBe(404);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(stored.isArchived).toBe(false);
    });

    it('rejects an unauthenticated archive and returns 404 for unknown conversations', async () => {
      const instanceName = await seedInstance();
      const conversationId = await createConversation(
        instanceName,
        '5511901000070@s.whatsapp.net',
      );

      const unauthorized = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/archive`,
      });
      expect(unauthorized.statusCode).toBe(401);

      const missing = await archive(randomUUID());
      expect(missing.statusCode).toBe(404);
      expect(missing.json().code).toBe('CONVERSATION_NOT_FOUND');
    });

    it('publishes conversation.updated when the archived state changes', async () => {
      const instanceName = await seedInstance();
      const conversationId = await createConversation(
        instanceName,
        '5511901000080@s.whatsapp.net',
      );
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      await archive(conversationId);

      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'conversation.updated',
        expect.objectContaining({ conversationId }),
      );
      emit.mockRestore();
    });

    it('returns an archived conversation to the inbox when a new message arrives', async () => {
      const instanceName = `archive-inbound-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá'));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      await archive(conversation.id);
      const archivedState = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(archivedState.isArchived).toBe(true);

      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Voltei'));

      const restored = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(restored.isArchived).toBe(false);

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);

      const inbound = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(inbound).toHaveLength(2);
    });

    it('does not unarchive when a duplicate event is reprocessed', async () => {
      const instanceName = `archive-dup-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const payload = evolutionPayload(instanceName, randomUUID(), 'Olá');
      await postWebhook(payload);
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      await archive(conversation.id);

      const duplicate = await postWebhook(payload);
      expect(duplicate.json().ignored).toBe('duplicate_event');

      const stillArchived = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stillArchived.isArchived).toBe(true);

      const inbound = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });
      expect(inbound).toHaveLength(1);
    });
  });
});
