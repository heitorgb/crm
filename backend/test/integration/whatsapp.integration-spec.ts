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

  function postWebhook(payload: object, token = 'test-webhook-secret') {
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
      expect(webhook?.events).toEqual(['MESSAGES_UPSERT', 'GROUPS_UPSERT', 'PRESENCE_UPDATE']);
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
});
