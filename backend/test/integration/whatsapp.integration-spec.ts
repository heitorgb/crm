import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../src/infrastructure/realtime/realtime.service.js';
import { EvolutionRequestError } from '../../src/modules/whatsapp/evolution/evolution.client.js';
import { WhatsAppInstancesService } from '../../src/modules/whatsapp/whatsapp-instances.service.js';
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

interface UpdatedMessage {
  instance: string;
  number: string;
  key: { id: string; remoteJid: string; fromMe: boolean };
  text: string;
}

class FakeEvolution {
  configured = true;
  readonly sent: { instance: string; number: string; text: string }[] = [];
  readonly sentMedia: SentMedia[] = [];
  readonly sentAudio: { instance: string; number: string; audio: string }[] = [];
  readonly updated: UpdatedMessage[] = [];
  readonly created: string[] = [];
  readonly deleted: string[] = [];
  readonly instances = new Map<string, string>();
  connectionStateOverride?: string;
  connectionStateError?: Error;
  readonly webhooks: { instance: string; url: string; events: string[] }[] = [];
  readonly groupLookups: string[] = [];
  readonly avatarLookups: string[] = [];
  createInstanceError?: { status: number; register?: boolean };
  createInstancePayload?: unknown;
  connectPayload?: unknown;
  connectBarrier?: Promise<void>;
  historyRecords: Record<string, unknown>[] = [];
  updateMessageError?: { status: number };
  mediaBase64?: string;
  mediaError?: { status: number };
  mediaMimeType?: string;
  mediaFileName?: string | null;
  mediaSize?: number;
  groupSubject: string | null = 'Grupo Teste';
  groupPictureUrl: string | null = 'https://cdn.example/group.jpg';
  groupParticipants: unknown[] = [];
  avatarUrl: string | null = 'https://cdn.example/avatar.jpg';
  private counter = 0;

  async createInstance(instanceName: string) {
    if (this.createInstancePayload !== undefined) {
      return this.createInstancePayload;
    }
    if (this.createInstanceError) {
      if (this.createInstanceError.register) {
        this.instances.set(instanceName, 'close');
      }
      throw new EvolutionRequestError('instance exists', this.createInstanceError.status);
    }
    this.created.push(instanceName);
    this.instances.set(instanceName, 'close');
    return { qrcode: { base64: 'ZmFrZS1xcg==', code: '2@fake' }, pairingCode: '12345678' };
  }

  async sendText(instance: string, number: string, text: string) {
    this.counter += 1;
    this.sent.push({ instance, number, text });
    return { externalMessageId: `ext-${this.counter}`, raw: {} };
  }

  async connect(instance: string) {
    if (this.connectBarrier) {
      await this.connectBarrier;
    }
    if (this.connectPayload !== undefined) {
      return this.connectPayload;
    }
    this.instances.set(instance, 'connecting');
    return { code: '2@existing', base64: 'ZXhpc3Rpbmc=' };
  }

  async disconnect(instance: string) {
    this.instances.set(instance, 'close');
    return {};
  }

  async deleteInstance(instance: string) {
    this.deleted.push(instance);
    this.instances.delete(instance);
    return {};
  }

  async findMessages(_instance: string, query: { page: number; limit: number }) {
    const start = (query.page - 1) * query.limit;
    return {
      total: this.historyRecords.length,
      pages: Math.max(1, Math.ceil(this.historyRecords.length / query.limit)),
      records: this.historyRecords.slice(start, start + query.limit),
    };
  }

  async instanceExists(instance: string) {
    return this.instances.has(instance);
  }

  async getConnectionState(instance: string) {
    if (this.connectionStateError) {
      throw this.connectionStateError;
    }
    return {
      instance,
      state: this.connectionStateOverride ?? this.instances.get(instance) ?? 'open',
    };
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

  async updateMessage(instance: string, input: Omit<UpdatedMessage, 'instance'>) {
    if (this.updateMessageError) {
      throw new EvolutionRequestError('update failed', this.updateMessageError.status);
    }
    this.updated.push({ ...input, instance });
    return { key: input.key, status: 'EDITED' };
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

  async findGroupParticipants(_instance: string, _groupJid: string) {
    return this.groupParticipants;
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
    evolution.updated.length = 0;
    evolution.created.length = 0;
    evolution.deleted.length = 0;
    evolution.instances.clear();
    evolution.connectionStateOverride = undefined;
    evolution.connectionStateError = undefined;
    evolution.webhooks.length = 0;
    evolution.groupLookups.length = 0;
    evolution.avatarLookups.length = 0;
    evolution.contactLookups.length = 0;
    evolution.addressBook = [];
    evolution.createInstanceError = undefined;
    evolution.createInstancePayload = undefined;
    evolution.connectPayload = undefined;
    evolution.connectBarrier = undefined;
    evolution.historyRecords = [];
    evolution.updateMessageError = undefined;
    evolution.mediaBase64 = undefined;
    evolution.mediaError = undefined;
    evolution.mediaMimeType = undefined;
    evolution.mediaFileName = undefined;
    evolution.mediaSize = undefined;
    evolution.groupSubject = 'Grupo Teste';
    evolution.groupPictureUrl = 'https://cdn.example/group.jpg';
    evolution.groupParticipants = [];
    evolution.avatarUrl = 'https://cdn.example/avatar.jpg';
    ownerA = await seedTenant(app, prisma, { name: 'Wa Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Wa User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Wa Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  async function createInstance(
    tenant: SeededTenant,
    instanceName: string,
    status: 'CONNECTED' | 'DISCONNECTED' = 'CONNECTED',
  ): Promise<string> {
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
    const id = response.json().id as string;
    await prisma.whatsAppInstance.update({ where: { id }, data: { status } });
    return id;
  }

  function evolutionPayload(
    instanceName: string,
    messageId: string,
    text: string,
    remoteJid = '5511999999999@s.whatsapp.net',
    remoteJidAlt?: string,
  ) {
    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: {
          remoteJid,
          fromMe: false,
          id: messageId,
          ...(remoteJidAlt ? { remoteJidAlt } : {}),
        },
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
      fromMe?: boolean;
    } = {},
  ) {
    const {
      remoteJid = '5511999999999@s.whatsapp.net',
      participant,
      participantAlt,
      pushName = 'Contato Teste',
      targetId = randomUUID(),
      targetFromMe = false,
      fromMe = false,
    } = options;

    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: {
          remoteJid,
          fromMe,
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
    options: { observedAt?: Date } = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/webhooks/evolution?token=${token}`,
      headers: options.observedAt
        ? { 'x-timestamp': options.observedAt.getTime().toString() }
        : undefined,
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

    it('reports the quota for the current organization only', async () => {
      const initial = await app.inject({
        method: 'GET',
        url: '/api/whatsapp/instances/quota',
        headers: authHeaders(ownerA),
      });
      expect(initial.statusCode).toBe(200);
      expect(initial.json()).toEqual({ used: 0, canCreate: true });

      await createInstance(ownerA, `quota-${randomUUID()}`, 'DISCONNECTED');

      const afterCreate = await app.inject({
        method: 'GET',
        url: '/api/whatsapp/instances/quota',
        headers: authHeaders(ownerA),
      });
      expect(afterCreate.json()).toEqual({ used: 1, canCreate: true });

      const otherTenant = await app.inject({
        method: 'GET',
        url: '/api/whatsapp/instances/quota',
        headers: authHeaders(ownerB),
      });
      expect(otherTenant.json()).toEqual({ used: 0, canCreate: true });
    });

    it('enforces the default instance limit, including disconnected instances', async () => {
      await createInstance(ownerA, `limit-a-${randomUUID()}`, 'CONNECTED');
      await createInstance(ownerA, `limit-b-${randomUUID()}`, 'DISCONNECTED');
      await createInstance(ownerA, `limit-c-${randomUUID()}`, 'DISCONNECTED');

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/instances',
        headers: authHeaders(ownerA),
        payload: { name: 'Above limit', instanceName: `limit-d-${randomUUID()}` },
      });

      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().code).toBe('WHATSAPP_INSTANCE_LIMIT_REACHED');
      await expect(
        prisma.whatsAppInstance.count({ where: { tenantId: ownerA.tenantId } }),
      ).resolves.toBe(3);
    });

    it('frees a slot when an instance is deleted', async () => {
      await prisma.tenant.update({
        where: { id: ownerA.tenantId },
        data: { whatsappInstanceLimit: 1 },
      });
      const firstId = await createInstance(ownerA, `single-${randomUUID()}`);

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/instances',
        headers: authHeaders(ownerA),
        payload: { name: 'Second', instanceName: `second-${randomUUID()}` },
      });
      expect(blocked.statusCode).toBe(409);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/whatsapp/instances/${firstId}`,
        headers: authHeaders(ownerA),
      });
      expect(removed.statusCode).toBe(204);
      const removedRow = await prisma.whatsAppInstance.findUnique({ where: { id: firstId } });
      expect(removedRow).toBeNull();

      const created = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/instances',
        headers: authHeaders(ownerA),
        payload: { name: 'Second', instanceName: `second-${randomUUID()}` },
      });
      expect(created.statusCode).toBe(201);
    });

    it('keeps existing instances when the limit is reduced below usage', async () => {
      for (let index = 0; index < 3; index += 1) {
        await createInstance(ownerA, `reduced-${index}-${randomUUID()}`);
      }

      await prisma.tenant.update({
        where: { id: ownerA.tenantId },
        data: { whatsappInstanceLimit: 1 },
      });

      await expect(
        prisma.whatsAppInstance.count({ where: { tenantId: ownerA.tenantId } }),
      ).resolves.toBe(3);

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/whatsapp/instances',
        headers: authHeaders(ownerA),
        payload: { name: 'Above reduced limit', instanceName: `reduced-4-${randomUUID()}` },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().code).toBe('WHATSAPP_INSTANCE_LIMIT_REACHED');
    });

    it('does not exceed the limit under concurrent creations', async () => {
      await prisma.tenant.update({
        where: { id: ownerA.tenantId },
        data: { whatsappInstanceLimit: 3 },
      });

      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/api/whatsapp/instances',
            headers: authHeaders(ownerA),
            payload: {
              name: `Concurrent ${index}`,
              instanceName: `concurrent-${index}-${randomUUID()}`,
            },
          }),
        ),
      );

      const created = responses.filter((response) => response.statusCode === 201);
      const blocked = responses.filter((response) => response.statusCode === 409);
      expect(created).toHaveLength(3);
      expect(blocked).toHaveLength(7);
      for (const response of blocked) {
        expect(response.json().code).toBe('WHATSAPP_INSTANCE_LIMIT_REACHED');
      }
      await expect(
        prisma.whatsAppInstance.count({ where: { tenantId: ownerA.tenantId } }),
      ).resolves.toBe(3);
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
        'MESSAGES_SET',
        'MESSAGING_HISTORY_SET',
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'MESSAGES_EDITED',
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
        'CHATS_SET',
        'CHATS_UPSERT',
        'CHATS_UPDATE',
        'GROUPS_UPSERT',
        'GROUP_UPDATE',
        'GROUP_PARTICIPANTS_UPDATE',
        'PRESENCE_UPDATE',
        'CONNECTION_UPDATE',
        'QRCODE_UPDATED',
        'STATUS_INSTANCE',
        'LOGOUT_INSTANCE',
      ]);
      expect(webhook?.url).toContain('/api/webhooks/evolution?token=');
      expect(JSON.stringify(response.json())).not.toContain('super-secret-webhook');
    });

    it('reuses an existing Evolution instance without recreating it', async () => {
      const instanceName = `existing-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      evolution.instances.set(instanceName, 'close');

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().code).toBe('2@existing');
      expect(evolution.deleted).not.toContain(instanceName);
      expect(evolution.created).not.toContain(instanceName);
    });

    it('returns CONNECTED without a new ticket when the instance is already open', async () => {
      const instanceName = `open-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'CONNECTED');
      evolution.instances.set(instanceName, 'open');

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ status: 'CONNECTED', code: null });
      expect(evolution.deleted).not.toContain(instanceName);
      expect(evolution.created).not.toContain(instanceName);
    });

    it('never deletes the provider instance when connect returns no ticket', async () => {
      const instanceName = `stale-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      evolution.instances.set(instanceName, 'close');
      evolution.connectPayload = { error: true, message: 'instance does not exist' };

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(502);
      expect(evolution.deleted).not.toContain(instanceName);
      const stored = await prisma.whatsAppInstance.findUnique({ where: { id: instanceId } });
      expect(stored?.status).toBe('CONNECTED');
    });

    it('reuses a concurrent instance when create loses the race', async () => {
      const instanceName = `race-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      evolution.createInstanceError = { status: 409, register: true };

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().code).toBe('2@existing');
      expect(evolution.deleted).not.toContain(instanceName);
      expect(evolution.created).not.toContain(instanceName);
    });

    it('does not mark the instance CONNECTING when Evolution returns an error payload', async () => {
      const instanceName = `broken-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'DISCONNECTED');
      evolution.createInstancePayload = { error: true, message: 'instance does not exist' };

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(502);
      const stored = await prisma.whatsAppInstance.findUnique({ where: { id: instanceId } });
      expect(stored?.status).toBe('DISCONNECTED');
    });

    it('marks the instance disconnected after Evolution confirms the logout', async () => {
      const instanceName = `disconnect-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'CONNECTED');

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/disconnect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('DISCONNECTED');
      const stored = await prisma.whatsAppInstance.findUnique({ where: { id: instanceId } });
      expect(stored?.status).toBe('DISCONNECTED');
    });

    it('ignores a delayed connection open event after an explicit disconnect', async () => {
      const instanceName = `disconnect-stale-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'CONNECTED');

      await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/disconnect`,
        headers: authHeaders(ownerA),
      });

      await postWebhook({
        event: 'connection.update',
        instance: instanceName,
        data: { instance: instanceName, state: 'open' },
      });

      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.status).toBe('DISCONNECTED');
    });

    it('does not mark the instance disconnected when Evolution remains connecting', async () => {
      const instanceName = `stuck-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'CONNECTED');
      evolution.instances.set(instanceName, 'connecting');
      evolution.connectionStateOverride = 'connecting';

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/disconnect`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(502);
      const stored = await prisma.whatsAppInstance.findUnique({ where: { id: instanceId } });
      expect(stored?.status).toBe('CONNECTED');
    });

    it('updates the QR on rotation and confirms the connection through the open event', async () => {
      const instanceName = `lifecycle-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'DISCONNECTED');
      evolution.instances.set(instanceName, 'close');
      const qrEmit = vi.spyOn(app.get(RealtimeService), 'emitToTenantAdmins');
      const tenantEmit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      const connect = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });
      expect(connect.statusCode).toBe(201);
      expect(connect.json()).toMatchObject({ status: 'CONNECTING', code: '2@existing' });

      const rotated = await postWebhook({
        event: 'qrcode.updated',
        instance: instanceName,
        data: {
          qrcode: { base64: 'cm90YXRlZA==', code: '2@rotated', pairingCode: '87654321' },
        },
      });
      expect(rotated.statusCode).toBe(200);
      expect(qrEmit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'whatsapp.instance.qr',
        expect.objectContaining({ instanceId, code: '2@rotated' }),
      );

      const persistedQr = await prisma.webhookEvent.count({
        where: { eventType: 'qrcode.updated', tenantId: ownerA.tenantId },
      });
      expect(persistedQr).toBe(0);

      await postWebhook({
        event: 'connection.update',
        instance: instanceName,
        data: { instance: instanceName, state: 'open', statusReason: 200 },
      });

      const connected = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(connected.status).toBe('CONNECTED');
      expect(tenantEmit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'whatsapp.instance.updated',
        expect.objectContaining({ instanceId, status: 'CONNECTED' }),
      );

      await postWebhook({
        event: 'status.instance',
        instance: instanceName,
        data: {
          instance: instanceName,
          status: 'closed',
          disconnectionReasonCode: 401,
        },
      });

      const disconnected = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(disconnected.status).toBe('DISCONNECTED');
      expect(disconnected.connectionStatusReason).toBe(401);
    });

    it('does not let an older close event override a newer open event', async () => {
      const instanceName = `out-of-order-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'DISCONNECTED');
      evolution.instances.set(instanceName, 'close');

      await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      const newer = new Date(Date.now() + 2_000);
      const older = new Date(Date.now() + 1_000);

      await app.inject({
        method: 'POST',
        url: `/api/webhooks/evolution?token=test-webhook-secret`,
        headers: {
          'x-timestamp': newer.getTime().toString(),
        },
        payload: {
          event: 'connection.update',
          instance: instanceName,
          data: { instance: instanceName, state: 'open' },
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/webhooks/evolution?token=test-webhook-secret`,
        headers: {
          'x-timestamp': older.getTime().toString(),
        },
        payload: {
          event: 'connection.update',
          instance: instanceName,
          data: { instance: instanceName, state: 'close', statusReason: 401 },
        },
      });

      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.status).toBe('CONNECTED');
    });

    it('marks the instance as ERROR when Evolution refuses the session and allows a new QR', async () => {
      const instanceName = `refused-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'DISCONNECTED');
      evolution.instances.set(instanceName, 'close');

      await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      await postWebhook({
        event: 'connection.update',
        instance: instanceName,
        data: { instance: instanceName, state: 'refused', statusReason: 428 },
      });

      const refused = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(refused.status).toBe('ERROR');
      expect(refused.connectionStatusReason).toBe(428);

      evolution.instances.set(instanceName, 'close');
      const retry = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });
      expect(retry.statusCode).toBe(201);
      expect(retry.json()).toMatchObject({ status: 'CONNECTING', code: '2@existing' });
    });

    it('does not downgrade the stored state when Evolution is unavailable', async () => {
      const instanceName = `provider-down-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'CONNECTED');
      evolution.connectionStateError = new EvolutionRequestError('timeout');

      const response = await app.inject({
        method: 'GET',
        url: `/api/whatsapp/instances/${instanceId}/status`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(502);
      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.status).toBe('CONNECTED');
    });

    it('reconciles a state lost while the backend was down', async () => {
      const instanceName = `reconcile-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'CONNECTED');
      evolution.instances.set(instanceName, 'close');

      await app.get(WhatsAppInstancesService).reconcileConnectionStates();

      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.status).toBe('DISCONNECTED');
    });

    it('rejects a concurrent connect for the same instance with 409', async () => {
      const instanceName = `concurrent-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName, 'DISCONNECTED');
      evolution.instances.set(instanceName, 'close');

      let release: () => void = () => undefined;
      evolution.connectBarrier = new Promise<void>((resolve) => {
        release = resolve;
      });

      const first = app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });
      const second = app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/connect`,
        headers: authHeaders(ownerA),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      release();

      const responses = await Promise.all([first, second]);
      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([201, 409]);
      expect(responses.find((response) => response.statusCode === 409)?.json()).toMatchObject({
        code: 'WHATSAPP_CONNECTION_IN_PROGRESS',
      });
      expect(evolution.instances.get(instanceName)).toBe('connecting');
    });

    it('keeps events isolated between tenants', async () => {
      const instanceA = `tenant-a-${randomUUID()}`;
      const instanceB = `tenant-b-${randomUUID()}`;
      const idA = await createInstance(ownerA, instanceA, 'CONNECTED');
      const idB = await createInstance(ownerB, instanceB, 'CONNECTED');
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      await Promise.all([
        postWebhook({
          event: 'connection.update',
          instance: instanceA,
          data: { instance: instanceA, state: 'close', statusReason: 401 },
        }),
        postWebhook({
          event: 'connection.update',
          instance: instanceB,
          data: { instance: instanceB, state: 'close', statusReason: 401 },
        }),
      ]);

      const [storedA, storedB] = await Promise.all([
        prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: idA } }),
        prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: idB } }),
      ]);
      expect(storedA.status).toBe('DISCONNECTED');
      expect(storedB.status).toBe('DISCONNECTED');

      const tenantEvents = emit.mock.calls.filter(
        ([, event]) => event === 'whatsapp.instance.updated',
      );
      expect(tenantEvents).toEqual(
        expect.arrayContaining([
          [
            ownerA.tenantId,
            'whatsapp.instance.updated',
            expect.objectContaining({ instanceId: idA }),
          ],
          [
            ownerB.tenantId,
            'whatsapp.instance.updated',
            expect.objectContaining({ instanceId: idB }),
          ],
        ]),
      );
      expect(tenantEvents).not.toContainEqual([
        ownerA.tenantId,
        'whatsapp.instance.updated',
        expect.objectContaining({ instanceId: idB }),
      ]);
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

  describe('contact sync', () => {
    async function connectAndSync(tenant: SeededTenant, instanceName: string) {
      const instanceId = await createInstance(tenant, instanceName, 'DISCONNECTED');
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
        {
          jid: '5511911111111@s.whatsapp.net',
          name: 'Alice',
          avatarUrl: 'https://cdn.example/alice.jpg',
        },
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
        {
          jid: `${phone}@s.whatsapp.net`,
          name: 'Nome WhatsApp',
          avatarUrl: 'https://cdn.example/x.jpg',
        },
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

    it('updates existing contacts from incremental events without duplicating or overwriting manual names', async () => {
      const instanceName = `contact-event-${randomUUID()}`;
      const phone = '5511977777777';
      await createInstance(ownerA, instanceName);
      await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, phone, name: 'Nome Manual' },
      });

      const first = await postWebhook({
        event: 'CONTACTS_UPSERT',
        instance: instanceName,
        data: {
          remoteJid: `${phone}@s.whatsapp.net`,
          pushName: 'Nome WhatsApp',
          profilePicUrl: 'https://pps.whatsapp.net/avatar.jpg',
        },
      });
      const second = await postWebhook({
        event: 'CONTACTS_UPDATE',
        instance: instanceName,
        data: {
          remoteJid: `${phone}@s.whatsapp.net`,
          pushName: 'Outro Nome',
          profilePicUrl: 'https://pps.whatsapp.net/avatar-2.jpg',
        },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const contacts = await prisma.contact.findMany({
        where: { tenantId: ownerA.tenantId, phone },
      });
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({
        name: 'Nome Manual',
        avatarUrl: 'https://pps.whatsapp.net/avatar-2.jpg',
      });
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

    it('imports recent messages.set history, filters old messages and deduplicates', async () => {
      const instanceName = `history-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const now = Math.floor(Date.now() / 1000);
      const old = now - 60 * 24 * 60 * 60;
      const recentId = randomUUID();
      const oldId = randomUUID();
      const groupId = randomUUID();
      const payload = {
        event: 'messages.set',
        instance: instanceName,
        isLatest: true,
        progress: 100,
        data: [
          {
            key: { remoteJid: '5511977777777@s.whatsapp.net', fromMe: false, id: recentId },
            pushName: 'Histórico',
            message: { conversation: 'mensagem recente do histórico' },
            messageTimestamp: now,
          },
          {
            key: { remoteJid: '5511977777777@s.whatsapp.net', fromMe: false, id: oldId },
            pushName: 'Histórico',
            message: { conversation: 'mensagem antiga' },
            messageTimestamp: old,
          },
          {
            key: {
              remoteJid: '120363000000000001@g.us',
              fromMe: false,
              id: groupId,
              participant: '5511888888888@s.whatsapp.net',
            },
            pushName: 'Maria',
            message: { conversation: 'mensagem de grupo do histórico' },
            messageTimestamp: now,
          },
        ],
      };

      const response = await postWebhook(payload);

      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);

      const messages = await prisma.message.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(messages).toHaveLength(2);
      expect(messages.map((message) => message.content)).toEqual(
        expect.arrayContaining(['mensagem recente do histórico', 'mensagem de grupo do histórico']),
      );
      expect(messages.some((message) => message.content === 'mensagem antiga')).toBe(false);

      await postWebhook(payload);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(2);
    });

    it('persists history synchronization progress without completing on isLatest', async () => {
      const instanceName = `history-state-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.set',
        instance: instanceName,
        isLatest: true,
        progress: 40,
        data: [],
      });

      let stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.historySyncStatus).toBe('SYNCING');
      expect(stored.historySyncProgress).toBe(40);
      expect(stored.historySyncCompletedAt).toBeNull();

      const response = await app.inject({
        method: 'GET',
        url: `/api/whatsapp/instances/${instanceId}`,
        headers: authHeaders(ownerA),
      });
      expect(response.json().historySync).toMatchObject({
        status: 'SYNCING',
        progress: 40,
        completedAt: null,
      });

      await postWebhook({
        event: 'messages.set',
        instance: instanceName,
        isLatest: false,
        progress: 100,
        data: [],
      });

      stored = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instanceId } });
      expect(stored.historySyncStatus).toBe('COMPLETED');
      expect(stored.historySyncProgress).toBe(100);
      expect(stored.historySyncCompletedAt).not.toBeNull();
    });

    it('accepts the explicit messaging-history.set completion signal', async () => {
      const instanceName = `history-complete-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      await postWebhook({
        event: 'messaging-history.set',
        instance: instanceName,
        data: { messageCount: 4, chatCount: 2, contactCount: 1, progress: 100 },
      });

      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.historySyncStatus).toBe('COMPLETED');
      expect(stored.historySyncProgress).toBe(100);
      expect(stored.historySyncMessages).toBe(4);
      expect(stored.historySyncCompletedAt).not.toBeNull();
      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'whatsapp.history.updated',
        expect.objectContaining({
          instanceId,
          status: 'COMPLETED',
          progress: 100,
          messages: 4,
        }),
      );
    });

    it('updates the real progress and chunk order from the history notification', async () => {
      const instanceName = `history-notification-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      const observedAt = new Date();
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');

      await postWebhook(
        {
          event: 'messages.edited',
          instance: instanceName,
          data: {
            type: 'HISTORY_SYNC_NOTIFICATION',
            historySyncNotification: {
              progress: 83,
              chunkOrder: 14,
              syncType: 'RECENT',
            },
          },
        },
        undefined,
        { observedAt },
      );

      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.historySyncStatus).toBe('SYNCING');
      expect(stored.historySyncProgress).toBe(83);
      expect(stored.historySyncChunks).toBe(14);
      expect(stored.historySyncUpdatedAt).toEqual(observedAt);

      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        'whatsapp.history.updated',
        expect.objectContaining({
          instanceId,
          status: 'SYNCING',
          progress: 83,
          chunks: 14,
          updatedAt: observedAt,
        }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/whatsapp/instances/${instanceId}`,
        headers: authHeaders(ownerA),
      });
      expect(response.json().historySync).toMatchObject({
        status: 'SYNCING',
        progress: 83,
        chunks: 14,
      });
    });

    it('keeps an indeterminate sync state when the provider sends no percentage', async () => {
      const instanceName = `history-no-progress-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messages.set',
        instance: instanceName,
        data: [],
      });

      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.historySyncStatus).toBe('SYNCING');
      expect(stored.historySyncProgress).toBeNull();
      expect(stored.historySyncCompletedAt).toBeNull();
    });

    it('does not let an older sync event overwrite more recent progress', async () => {
      const instanceName = `history-order-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);

      await postWebhook(
        {
          event: 'messages.set',
          instance: instanceName,
          progress: 80,
          data: [],
        },
        undefined,
        { observedAt: new Date() },
      );
      await postWebhook(
        {
          event: 'messages.set',
          instance: instanceName,
          progress: 20,
          data: [],
        },
        undefined,
        { observedAt: new Date(Date.now() - 60_000) },
      );

      const stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.historySyncStatus).toBe('SYNCING');
      expect(stored.historySyncProgress).toBe(80);
    });

    it('starts a new cycle when a completed instance syncs again', async () => {
      const instanceName = `history-reconnect-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);

      await postWebhook({
        event: 'messaging-history.set',
        instance: instanceName,
        data: { progress: 100, messageCount: 2 },
      });

      let stored = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(stored.historySyncStatus).toBe('COMPLETED');

      await postWebhook(
        {
          event: 'messages.set',
          instance: instanceName,
          progress: 5,
          data: [],
        },
        undefined,
        { observedAt: new Date() },
      );

      stored = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instanceId } });
      expect(stored.historySyncStatus).toBe('SYNCING');
      expect(stored.historySyncProgress).toBe(5);
      expect(stored.historySyncCompletedAt).toBeNull();
    });

    it('keeps history sync state isolated between tenants', async () => {
      const instanceA = `history-tenant-a-${randomUUID()}`;
      const instanceB = `history-tenant-b-${randomUUID()}`;
      const idA = await createInstance(ownerA, instanceA);
      const idB = await createInstance(ownerB, instanceB);

      await Promise.all([
        postWebhook({
          event: 'messages.edited',
          instance: instanceA,
          data: {
            type: 'HISTORY_SYNC_NOTIFICATION',
            historySyncNotification: { progress: 30, chunkOrder: 3 },
          },
        }),
        postWebhook({
          event: 'messages.edited',
          instance: instanceB,
          data: {
            type: 'HISTORY_SYNC_NOTIFICATION',
            historySyncNotification: { progress: 70, chunkOrder: 8 },
          },
        }),
      ]);

      const [storedA, storedB] = await Promise.all([
        prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: idA } }),
        prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: idB } }),
      ]);
      expect([storedA.historySyncProgress, storedA.historySyncChunks]).toEqual([30, 3]);
      expect([storedB.historySyncProgress, storedB.historySyncChunks]).toEqual([70, 8]);
    });

    it('keeps messages received during history synchronization', async () => {
      const instanceName = `history-live-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      const now = Math.floor(Date.now() / 1000);

      await postWebhook({
        event: 'messages.set',
        instance: instanceName,
        progress: 50,
        data: [
          {
            key: { remoteJid: '5511777777777@s.whatsapp.net', fromMe: false, id: randomUUID() },
            pushName: 'Histórico',
            message: { conversation: 'do histórico' },
            messageTimestamp: now,
          },
        ],
      });
      await postWebhook(
        evolutionPayload(instanceName, randomUUID(), 'recebida durante a sincronização'),
      );

      const duringSync = await prisma.whatsAppInstance.findUniqueOrThrow({
        where: { id: instanceId },
      });
      expect(duringSync.historySyncStatus).toBe('SYNCING');
      expect(duringSync.historySyncProgress).toBe(50);

      await postWebhook({
        event: 'messages.set',
        instance: instanceName,
        progress: 100,
        data: [],
      });

      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { occurredAt: 'asc' },
      });
      expect(messages.map((message) => message.content)).toEqual(
        expect.arrayContaining(['do histórico', 'recebida durante a sincronização']),
      );
    });

    it('accepts uppercase webhook event names from the provider', async () => {
      const instanceName = `uppercase-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const response = await postWebhook({
        event: 'MESSAGES_UPSERT',
        instance: instanceName,
        data: {
          key: { remoteJid: '5511666666666@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Contato Teste',
          message: { conversation: 'evento em maiúsculas' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(
        await prisma.message.count({
          where: { tenantId: ownerA.tenantId, content: 'evento em maiúsculas' },
        }),
      ).toBe(1);
    });

    it('does not move an active conversation back in time when importing older history', async () => {
      const instanceName = `history-order-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'mensagem atual'));
      const before = await prisma.conversation.findFirst({
        where: { tenantId: ownerA.tenantId },
        select: { id: true, lastMessageAt: true },
      });

      const old = Math.floor(Date.now() / 1000) - 60 * 60;
      await postWebhook({
        event: 'messages.set',
        instance: instanceName,
        data: [
          {
            key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: randomUUID() },
            pushName: 'Contato Teste',
            message: { conversation: 'mensagem de uma hora atrás' },
            messageTimestamp: old,
          },
        ],
      });

      const after = await prisma.conversation.findUnique({
        where: { id: before?.id },
        select: { lastMessageAt: true },
      });
      expect(after?.lastMessageAt?.toISOString()).toBe(before?.lastMessageAt?.toISOString());
    });

    it('backfills missing messages from Evolution and keeps tenant isolation', async () => {
      const instanceName = `backfill-${randomUUID()}`;
      const instanceId = await createInstance(ownerA, instanceName);
      const now = Math.floor(Date.now() / 1000);
      evolution.historyRecords = [
        {
          key: { remoteJid: '5511966666666@s.whatsapp.net', fromMe: false, id: randomUUID() },
          pushName: 'Backfill',
          message: { conversation: 'recuperada individual' },
          messageTimestamp: now,
        },
        {
          key: {
            remoteJid: '120363000000000002@g.us',
            fromMe: false,
            id: randomUUID(),
            participant: '5511888888888@s.whatsapp.net',
          },
          pushName: 'Maria',
          message: { conversation: 'recuperada de grupo' },
          messageTimestamp: now,
        },
      ];

      const response = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/backfill`,
        headers: authHeaders(ownerA),
        payload: { days: 7, maxMessages: 100 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ scanned: 2, imported: 2, skipped: 0, failed: 0 });

      const messages = await prisma.message.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(messages).toHaveLength(2);
      const groupConversation = await prisma.conversation.findFirst({
        where: { tenantId: ownerA.tenantId, externalContactId: '120363000000000002@g.us' },
      });
      expect(groupConversation?.isGroup).toBe(true);

      const foreign = await app.inject({
        method: 'POST',
        url: `/api/whatsapp/instances/${instanceId}/backfill`,
        headers: authHeaders(ownerB),
        payload: { days: 7 },
      });
      expect(foreign.statusCode).toBe(404);
    });

    it('ignores inbound messages from a blocked contact', async () => {
      const instanceName = `blocked-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await prisma.contact.create({
        data: {
          tenantId: ownerA.tenantId,
          phone: '5511999999999',
          name: 'Bloqueado',
          isBlocked: true,
        },
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
        data: {
          tenantId: ownerA.tenantId,
          phone: '5511999999999',
          name: 'Bloqueado',
          isBlocked: true,
        },
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

    it('retries a webhook whose message persistence failed instead of dropping it', async () => {
      const instanceName = `transient-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const messageId = randomUUID();
      const payload = evolutionPayload(instanceName, messageId, 'não pode ser perdida');

      const create = vi
        .spyOn(prisma.message, 'create')
        .mockRejectedValueOnce(new Error('database unavailable'));
      try {
        const first = await postWebhook(payload);
        expect(first.statusCode).toBe(503);
      } finally {
        create.mockRestore();
      }

      const stored = await prisma.message.findFirst({
        where: { tenantId: ownerA.tenantId, externalMessageId: messageId },
      });
      expect(stored?.content).toBe('não pode ser perdida');

      const retry = await postWebhook(payload);
      expect(retry.statusCode).toBe(200);
      expect(
        await prisma.message.count({
          where: { tenantId: ownerA.tenantId, externalMessageId: messageId },
        }),
      ).toBe(1);
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

    describe('quoted replies', () => {
      const GROUP_JID = '120363000000000001@g.us';
      const PARTICIPANT = '5511888888888@s.whatsapp.net';

      function audioWithContextPayload(input: {
        instanceName: string;
        messageId: string;
        contextInfo: Record<string, unknown>;
        remoteJid?: string;
        participant?: string;
        pushName?: string;
        seconds?: number;
      }) {
        const {
          instanceName,
          messageId,
          contextInfo,
          remoteJid = '5511999999999@s.whatsapp.net',
          participant,
          pushName = 'Contato Teste',
          seconds = 5,
        } = input;
        return {
          event: 'messages.upsert',
          instance: instanceName,
          data: {
            key: {
              remoteJid,
              fromMe: false,
              id: messageId,
              ...(participant ? { participant } : {}),
            },
            pushName,
            messageType: 'audioMessage',
            message: {
              audioMessage: {
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                seconds,
                contextInfo,
              },
              messageContextInfo: { threadId: [] },
            },
          },
        };
      }

      function groupAudioPayload(input: {
        instanceName: string;
        messageId: string;
        participant: string;
        pushName: string;
        seconds: number;
      }) {
        const { instanceName, messageId, participant, pushName, seconds } = input;
        return {
          event: 'messages.upsert',
          instance: instanceName,
          data: {
            key: {
              remoteJid: GROUP_JID,
              fromMe: false,
              id: messageId,
              participant,
            },
            pushName,
            messageType: 'audioMessage',
            message: {
              audioMessage: {
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                seconds,
              },
              messageContextInfo: { threadId: [] },
            },
          },
        };
      }

      it('does not quote an audio whose contextInfo only carries technical metadata', async () => {
        const instanceName = `audio-context-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const messageId = randomUUID();

        const response = await postWebhook(
          audioWithContextPayload({
            instanceName,
            messageId,
            remoteJid: GROUP_JID,
            participant: PARTICIPANT,
            pushName: 'Maria',
            seconds: 7,
            contextInfo: {
              mentionedJid: [],
              groupMentions: [],
              statusAttributions: [],
            },
          }),
        );

        expect(response.statusCode).toBe(200);
        const message = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: messageId },
        });
        const metadata = message.metadata as {
          quoted?: unknown;
          audioDurationSeconds?: number;
        };
        expect(metadata.quoted).toBeUndefined();
        expect(metadata.audioDurationSeconds).toBe(7);
        expect(message.type).toBe('AUDIO');
        expect(message.senderId).toBe(PARTICIPANT);
        expect(message.senderName).toBe('Maria');
      });

      it('persists the quote when an audio explicitly replies to an earlier message', async () => {
        const instanceName = `audio-reply-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const originalId = randomUUID();
        const audioId = randomUUID();

        await postWebhook(evolutionPayload(instanceName, originalId, 'Mensagem original'));

        await postWebhook(
          audioWithContextPayload({
            instanceName,
            messageId: audioId,
            contextInfo: {
              stanzaId: originalId,
              participant: '5511999999999@s.whatsapp.net',
              quotedMessage: { conversation: 'Mensagem original' },
            },
          }),
        );

        const original = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: originalId },
        });
        const audio = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: audioId },
        });
        const metadata = audio.metadata as {
          quoted?: {
            messageId?: string | null;
            externalId?: string | null;
            content?: string | null;
            type?: string;
          };
        };

        expect(metadata.quoted).toMatchObject({
          messageId: original.id,
          externalId: originalId,
          content: 'Mensagem original',
          type: 'TEXT',
        });
      });

      it('preserves quotes to text, image, video and document content', async () => {
        const instanceName = `audio-quote-types-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const cases = [
          { quotedMessage: { conversation: 'texto citado' }, type: 'TEXT' },
          { quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } }, type: 'IMAGE' },
          { quotedMessage: { videoMessage: { mimetype: 'video/mp4' } }, type: 'VIDEO' },
          {
            quotedMessage: { documentMessage: { mimetype: 'application/pdf' } },
            type: 'DOCUMENT',
          },
        ];
        const messageIds: string[] = [];

        for (const item of cases) {
          const messageId = randomUUID();
          messageIds.push(messageId);
          await postWebhook(
            audioWithContextPayload({
              instanceName,
              messageId,
              contextInfo: {
                stanzaId: randomUUID(),
                quotedMessage: item.quotedMessage,
              },
            }),
          );
        }

        const messages = await prisma.message.findMany({
          where: { tenantId: ownerA.tenantId, externalMessageId: { in: messageIds } },
        });
        const quotedTypes = messages.map(
          (message) => (message.metadata as { quoted?: { type?: string } }).quoted?.type ?? null,
        );
        expect(quotedTypes).toEqual(expect.arrayContaining(cases.map((item) => item.type)));
      });

      it('keeps the relationship when the reply targets an audio message', async () => {
        const instanceName = `reply-to-audio-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const originalAudioId = randomUUID();
        const replyId = randomUUID();

        await postWebhook(audioPayload(instanceName, originalAudioId));

        await postWebhook({
          event: 'messages.upsert',
          instance: instanceName,
          data: {
            key: {
              remoteJid: '5511999999999@s.whatsapp.net',
              fromMe: false,
              id: replyId,
            },
            pushName: 'Contato Teste',
            message: {
              extendedTextMessage: {
                text: 'Ouvi seu áudio',
                contextInfo: {
                  stanzaId: originalAudioId,
                  participant: '5511999999999@s.whatsapp.net',
                  quotedMessage: { audioMessage: { ptt: true, seconds: 5 } },
                },
              },
            },
          },
        });

        const originalAudio = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: originalAudioId },
        });
        expect((originalAudio.metadata as { quoted?: unknown }).quoted).toBeUndefined();
        const reply = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: replyId },
        });
        const metadata = reply.metadata as {
          quoted?: {
            messageId?: string | null;
            externalId?: string | null;
            type?: string;
          };
        };

        expect(metadata.quoted).toMatchObject({
          messageId: originalAudio.id,
          externalId: originalAudioId,
          type: 'AUDIO',
        });
      });

      it('quotes a group audio from another participant after Evolution flattens the text reply', async () => {
        const instanceName = `group-flattened-reply-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const originalAudioId = randomUUID();
        const replyId = randomUUID();
        const participantA = '75209205874877@lid';
        const participantB = '229428613357801@lid';

        await postWebhook(
          groupAudioPayload({
            instanceName,
            messageId: originalAudioId,
            participant: participantA,
            pushName: 'Kkroto',
            seconds: 28,
          }),
        );

        // Evolution 2.4 flattening: the reply arrives as `conversation` and the
        // quote context lives at the root of the event, not in a message part.
        await postWebhook({
          event: 'messages.upsert',
          instance: instanceName,
          data: {
            key: {
              remoteJid: GROUP_JID,
              fromMe: false,
              id: replyId,
              participant: participantB,
            },
            pushName: 'Caio',
            messageType: 'conversation',
            message: {
              conversation: 'Matar resolve logo',
              messageContextInfo: { threadId: [] },
            },
            contextInfo: {
              stanzaId: originalAudioId,
              participant: participantA,
              remoteJid: GROUP_JID,
              quotedMessage: { audioMessage: { ptt: true, seconds: 28 } },
            },
          },
        });

        const original = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: originalAudioId },
        });
        const reply = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: replyId },
        });
        const metadata = reply.metadata as {
          quoted?: {
            messageId?: string | null;
            externalId?: string | null;
            remoteJid?: string | null;
            authorName?: string | null;
            authorJid?: string | null;
            content?: string | null;
            type?: string;
            audioDurationSeconds?: number | null;
            fromMe?: boolean;
          };
        };

        expect(reply.content).toBe('Matar resolve logo');
        expect(reply.type).toBe('TEXT');
        expect(metadata.quoted).toMatchObject({
          messageId: original.id,
          externalId: originalAudioId,
          remoteJid: GROUP_JID,
          authorName: 'Kkroto',
          authorJid: participantA,
          type: 'AUDIO',
          audioDurationSeconds: 28,
          fromMe: false,
        });
      });

      it('quotes the same group audio for every participant that replies', async () => {
        const instanceName = `group-multiple-replies-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const originalAudioId = randomUUID();
        const participantA = '75209205874877@lid';
        const repliers = [
          { id: randomUUID(), participant: '229428613357801@lid', name: 'Caio' },
          { id: randomUUID(), participant: '226649819902207@lid', name: 'Alan' },
        ];

        await postWebhook(
          groupAudioPayload({
            instanceName,
            messageId: originalAudioId,
            participant: participantA,
            pushName: 'Kkroto',
            seconds: 28,
          }),
        );

        for (const replier of repliers) {
          await postWebhook({
            event: 'messages.upsert',
            instance: instanceName,
            data: {
              key: {
                remoteJid: GROUP_JID,
                fromMe: false,
                id: replier.id,
                participant: replier.participant,
              },
              pushName: replier.name,
              message: {
                extendedTextMessage: {
                  text: `Respondendo ${replier.name}`,
                  contextInfo: {
                    stanzaId: originalAudioId,
                    participant: participantA,
                    remoteJid: GROUP_JID,
                    quotedMessage: { audioMessage: { ptt: true, seconds: 28 } },
                  },
                },
              },
            },
          });
        }

        const replies = await prisma.message.findMany({
          where: {
            tenantId: ownerA.tenantId,
            externalMessageId: { in: repliers.map((replier) => replier.id) },
          },
        });

        expect(replies).toHaveLength(2);
        for (const reply of replies) {
          expect(reply.metadata).toMatchObject({
            quoted: {
              externalId: originalAudioId,
              authorName: 'Kkroto',
              authorJid: participantA,
              type: 'AUDIO',
              audioDurationSeconds: 28,
            },
          });
        }
      });

      it('resolves a LID author from the group participants when the original is not stored', async () => {
        const instanceName = `group-lid-author-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const participantLid = '63604221026389@lid';
        const participantPhone = '5511977777777';
        const replyId = randomUUID();

        await postWebhook(groupPayload(instanceName, randomUUID(), 'Contexto do grupo', GROUP_JID));

        const conversation = await prisma.conversation.findFirstOrThrow({
          where: {
            tenantId: ownerA.tenantId,
            whatsappInstanceId: (
              await prisma.whatsAppInstance.findFirstOrThrow({
                where: { tenantId: ownerA.tenantId, instanceName },
              })
            ).id,
            externalContactId: GROUP_JID,
          },
        });
        await prisma.conversationParticipant.create({
          data: {
            tenantId: ownerA.tenantId,
            conversationId: conversation.id,
            jid: `${participantPhone}@s.whatsapp.net`,
            lid: participantLid,
            phone: participantPhone,
            name: 'Kkroto',
          },
        });

        await postWebhook({
          event: 'messages.upsert',
          instance: instanceName,
          data: {
            key: {
              remoteJid: GROUP_JID,
              fromMe: false,
              id: replyId,
              participant: '229428613357801@lid',
            },
            pushName: 'Caio',
            message: { conversation: 'Então tem que deixar o tráfico?' },
            contextInfo: {
              stanzaId: randomUUID(),
              participant: participantLid,
              remoteJid: GROUP_JID,
              quotedMessage: { audioMessage: { ptt: true, seconds: 12 } },
            },
          },
        });

        const reply = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: replyId },
        });
        expect(reply.metadata).toMatchObject({
          quoted: {
            messageId: null,
            authorJid: participantLid,
            authorName: 'Kkroto',
            type: 'AUDIO',
            audioDurationSeconds: 12,
          },
        });
      });

      it('completes a quote when the original audio arrives after the reply', async () => {
        const instanceName = `group-late-original-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const originalAudioId = randomUUID();
        const replyId = randomUUID();
        const participantA = '75209205874877@lid';

        await postWebhook({
          event: 'messages.upsert',
          instance: instanceName,
          data: {
            key: {
              remoteJid: GROUP_JID,
              fromMe: false,
              id: replyId,
              participant: '229428613357801@lid',
            },
            pushName: 'Caio',
            message: { conversation: 'Matar resolve logo' },
            contextInfo: {
              stanzaId: originalAudioId,
              participant: participantA,
              quotedMessage: { audioMessage: { ptt: true, seconds: 28 } },
            },
          },
        });

        const before = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: replyId },
        });
        expect(before.metadata).toMatchObject({
          quoted: { messageId: null, externalId: originalAudioId, type: 'AUDIO' },
        });

        await postWebhook(
          groupAudioPayload({
            instanceName,
            messageId: originalAudioId,
            participant: participantA,
            pushName: 'Kkroto',
            seconds: 28,
          }),
        );

        const original = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: originalAudioId },
        });
        const after = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: replyId },
        });
        expect(after.metadata).toMatchObject({
          quoted: {
            messageId: original.id,
            externalId: originalAudioId,
            authorName: 'Kkroto',
            authorJid: participantA,
            type: 'AUDIO',
            audioDurationSeconds: 28,
          },
        });
      });

      it('keeps text quotes and never links across tenants', async () => {
        const instanceA = `quote-tenant-a-${randomUUID()}`;
        const instanceB = `quote-tenant-b-${randomUUID()}`;
        await createInstance(ownerA, instanceA);
        await createInstance(ownerB, instanceB);
        const originalId = randomUUID();
        const foreignReplyId = randomUUID();
        const textReplyId = randomUUID();

        await postWebhook(
          evolutionPayload(instanceA, originalId, 'Seria o que, umas 8 instâncias?'),
        );

        await postWebhook({
          event: 'messages.upsert',
          instance: instanceB,
          data: {
            key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: foreignReplyId },
            pushName: 'Contato B',
            message: { conversation: 'Referência externa' },
            contextInfo: {
              stanzaId: originalId,
              participant: '5511888888888@s.whatsapp.net',
              quotedMessage: { conversation: 'Seria o que, umas 8 instâncias?' },
            },
          },
        });

        await postWebhook({
          event: 'messages.upsert',
          instance: instanceA,
          data: {
            key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: textReplyId },
            pushName: 'Contato Teste',
            message: { conversation: 'Exatamente' },
            contextInfo: {
              stanzaId: originalId,
              participant: '5511999999999@s.whatsapp.net',
              quotedMessage: { conversation: 'Seria o que, umas 8 instâncias?' },
            },
          },
        });

        const foreignReply = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerB.tenantId, externalMessageId: foreignReplyId },
        });
        expect(foreignReply.metadata).toMatchObject({
          quoted: { messageId: null, externalId: originalId, type: 'TEXT' },
        });

        const original = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: originalId },
        });
        const textReply = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: textReplyId },
        });
        expect(textReply.metadata).toMatchObject({
          quoted: {
            messageId: original.id,
            externalId: originalId,
            type: 'TEXT',
            content: 'Seria o que, umas 8 instâncias?',
          },
        });
      });

      it('keeps an explicit reference whose quoted content is unavailable locally', async () => {
        const instanceName = `audio-missing-quote-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const audioId = randomUUID();
        const unavailableId = randomUUID();

        await postWebhook(
          audioWithContextPayload({
            instanceName,
            messageId: audioId,
            contextInfo: { stanzaId: unavailableId },
          }),
        );

        const audio = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: audioId },
        });
        const metadata = audio.metadata as {
          quoted?: {
            messageId?: string | null;
            externalId?: string | null;
            content?: string | null;
            type?: string;
          };
        };

        expect(metadata.quoted).toMatchObject({
          messageId: null,
          externalId: unavailableId,
          content: null,
          type: 'UNKNOWN',
        });
      });

      it('normalizes a flattened text reply imported from history', async () => {
        const instanceName = `group-history-reply-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const originalAudioId = randomUUID();
        const replyId = randomUUID();
        const participantA = '75209205874877@lid';

        await postWebhook(
          groupAudioPayload({
            instanceName,
            messageId: originalAudioId,
            participant: participantA,
            pushName: 'Kkroto',
            seconds: 28,
          }),
        );

        const response = await postWebhook({
          event: 'messages.set',
          instance: instanceName,
          isLatest: true,
          progress: 100,
          data: [
            {
              key: {
                remoteJid: GROUP_JID,
                fromMe: false,
                id: replyId,
                participant: '229428613357801@lid',
              },
              pushName: 'Caio',
              messageTimestamp: Math.floor(Date.now() / 1000),
              messageType: 'conversation',
              message: {
                conversation: 'Matar resolve logo',
                messageContextInfo: { threadId: [] },
              },
              contextInfo: {
                stanzaId: originalAudioId,
                participant: participantA,
                remoteJid: GROUP_JID,
                quotedMessage: { audioMessage: { ptt: true, seconds: 28 } },
              },
            },
          ],
        });

        expect(response.statusCode).toBe(200);
        const reply = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: replyId },
        });
        expect(reply.metadata).toMatchObject({
          quoted: {
            externalId: originalAudioId,
            authorName: 'Kkroto',
            authorJid: participantA,
            type: 'AUDIO',
            audioDurationSeconds: 28,
          },
        });
      });

      it('applies the same normalization to history and realtime audio', async () => {
        const instanceName = `audio-history-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const messageId = randomUUID();

        const response = await postWebhook({
          event: 'messages.set',
          instance: instanceName,
          isLatest: true,
          progress: 100,
          data: [
            {
              key: {
                remoteJid: GROUP_JID,
                fromMe: false,
                id: messageId,
                participant: PARTICIPANT,
              },
              pushName: 'Maria',
              messageTimestamp: Math.floor(Date.now() / 1000),
              message: {
                audioMessage: {
                  mimetype: 'audio/ogg; codecs=opus',
                  ptt: true,
                  seconds: 12,
                  contextInfo: { mentionedJid: [], groupMentions: [] },
                },
              },
            },
          ],
        });

        expect(response.statusCode).toBe(200);
        const message = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: messageId },
        });
        expect((message.metadata as { quoted?: unknown }).quoted).toBeUndefined();
        expect((message.metadata as { audioDurationSeconds?: number }).audioDurationSeconds).toBe(
          12,
        );
        expect(message.senderName).toBe('Maria');
      });
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
        outboundPayload(
          instanceName,
          outbound.externalMessageId as string,
          'Resposta enviada pelo CRM',
        ),
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

        expect(spy).toHaveBeenCalledWith(instanceName, expect.objectContaining({ fromMe: true }));
        const message = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId },
        });
        expect(message.type).toBe('IMAGE');
        expect(message.direction).toBe('OUTBOUND');
        expect(await prisma.messageAttachment.count({ where: { messageId: message.id } })).toBe(1);
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

    it('turns a SENT message into FAILED when the provider reports ERROR', async () => {
      const { instanceName, messageId, conversationId, externalMessageId } = await seedOutbound();
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToConversation');

      const response = await postWebhook(statusPayload(instanceName, externalMessageId, 'ERROR'));

      expect(response.statusCode).toBe(200);
      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('FAILED');
      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        conversationId,
        'message.updated',
        expect.objectContaining({ messageId, status: 'FAILED' }),
      );

      emit.mockRestore();
    });

    it('never regresses a READ message into FAILED on a late ERROR', async () => {
      const { instanceName, messageId, externalMessageId } = await seedOutbound();

      await postWebhook(statusPayload(instanceName, externalMessageId, 'READ'));
      await postWebhook(statusPayload(instanceName, externalMessageId, 'ERROR'));

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('READ');
    });

    it('ignores receipts for unknown messages without failing the webhook', async () => {
      const { instanceName } = await seedOutbound();

      const response = await postWebhook(statusPayload(instanceName, randomUUID(), 'DELIVERY_ACK'));

      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);
    });

    it('scopes status updates to the owning instance inside the same tenant', async () => {
      const { messageId, externalMessageId } = await seedOutbound();
      const otherInstance = `status-same-tenant-${randomUUID()}`;
      await createInstance(ownerA, otherInstance);

      await postWebhook(statusPayload(otherInstance, externalMessageId, 'READ'));

      const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(message.status).toBe('SENT');
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

    function editedUpsert(instanceName: string, editId: string, originalId: string, text: string) {
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

    /**
     * Evolution v2.3.7 + Baileys forwards an edit sent from the user's own phone
     * as a `messages.upsert` where the edit protocolMessage is wrapped in a
     * container envelope (deviceSent/ephemeral). Evolution's own detector misses
     * that envelope, so the raw shape must reach the CRM instead of a `[unknown]`.
     */
    function wrappedEdit(
      instanceName: string,
      container: 'deviceSentMessage' | 'ephemeralMessage',
      editId: string,
      originalId: string,
      text: string,
    ) {
      return {
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid, fromMe: true, id: editId },
          pushName: 'Atendente',
          message: {
            [container]: {
              message: {
                protocolMessage: {
                  key: { remoteJid, fromMe: true, id: originalId },
                  type: 14,
                  editedMessage: { conversation: text },
                },
              },
            },
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
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

    it.each(['deviceSentMessage', 'ephemeralMessage'] as const)(
      'applies an edit wrapped in %s without creating a [unknown]',
      async (container) => {
        const instanceName = `edit-wrap-${container}-${randomUUID()}`;
        await createInstance(ownerA, instanceName);
        const originalId = randomUUID();
        await postWebhook(outboundFromPhone(instanceName, originalId, 'Enviada do celular'));
        const original = await prisma.message.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId, externalMessageId: originalId },
        });

        const response = await postWebhook(
          wrappedEdit(instanceName, container, randomUUID(), originalId, 'Corrigida no celular'),
        );

        expect(response.statusCode).toBe(200);
        const updated = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
        expect(updated.content).toBe('Corrigida no celular');
        expect(updated.metadata).toMatchObject({ edited: true });
        expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
        expect(
          await prisma.message.count({ where: { tenantId: ownerA.tenantId, type: 'UNKNOWN' } }),
        ).toBe(0);
      },
    );

    it('ignores a non-edit protocol control message instead of persisting a [unknown]', async () => {
      const { instanceName } = await seedConversation();

      const response = await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: { remoteJid, fromMe: true, id: randomUUID() },
          pushName: 'Atendente',
          message: {
            protocolMessage: { type: 0, key: { remoteJid, fromMe: true, id: randomUUID() } },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ignored).toBe('unsupported_message');
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
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

  describe('message editing from the CRM', () => {
    async function seedOutbound(): Promise<{
      instanceName: string;
      conversationId: string;
      messageId: string;
      externalMessageId: string;
    }> {
      const instanceName = `crm-edit-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Olá'));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Resposta do CRM' },
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

    function editRequest(
      conversationId: string,
      messageId: string,
      content: string,
      tenant = ownerA,
    ) {
      return app.inject({
        method: 'PATCH',
        url: `/api/conversations/${conversationId}/messages/${messageId}`,
        headers: authHeaders(tenant),
        payload: { content },
      });
    }

    it('edits an outbound text message in place and notifies the chat', async () => {
      const { instanceName, conversationId, messageId, externalMessageId } = await seedOutbound();
      const original = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToConversation');

      const response = await editRequest(conversationId, messageId, 'Resposta corrigida');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: messageId, content: 'Resposta corrigida' });

      const updated = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(updated.content).toBe('Resposta corrigida');
      expect(updated.metadata).toMatchObject({ edited: true });
      expect(updated.occurredAt).toEqual(original.occurredAt);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(2);

      expect(evolution.updated).toHaveLength(1);
      expect(evolution.updated[0]).toMatchObject({
        instance: instanceName,
        number: '5511999999999',
        text: 'Resposta corrigida',
        key: { id: externalMessageId, remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
      });

      expect(emit).toHaveBeenCalledWith(
        ownerA.tenantId,
        conversationId,
        'message.updated',
        expect.objectContaining({ messageId }),
      );
      emit.mockRestore();
    });

    it('edits the caption of an outbound image message', async () => {
      const { conversationId, messageId } = await seedOutbound();
      await prisma.message.update({
        where: { id: messageId },
        data: { type: 'IMAGE', content: 'legenda antiga' },
      });

      const response = await editRequest(conversationId, messageId, 'legenda nova');

      expect(response.statusCode).toBe(200);
      const updated = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(updated.type).toBe('IMAGE');
      expect(updated.content).toBe('legenda nova');
      expect(evolution.updated[0]?.text).toBe('legenda nova');
    });

    it('reuses the full group JID as number and key when editing a group message', async () => {
      const instanceName = `crm-edit-group-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const groupJid = '120363555555555555@g.us';
      await postWebhook({
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: {
            remoteJid: groupJid,
            fromMe: false,
            id: randomUUID(),
            participant: '5511888888888@s.whatsapp.net',
          },
          pushName: 'Maria',
          message: { conversation: 'Olá grupo' },
        },
      });
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Resposta no grupo' },
      });
      const outbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'OUTBOUND' },
      });

      const response = await editRequest(conversation.id, outbound.id, 'Corrigida no grupo');

      expect(response.statusCode).toBe(200);
      expect(evolution.updated[0]).toMatchObject({
        number: groupJid,
        key: { id: outbound.externalMessageId, remoteJid: groupJid, fromMe: true },
      });
    });

    it('never edits a received message', async () => {
      const instanceName = `crm-edit-in-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Mensagem recebida'));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const inbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'INBOUND' },
      });

      const response = await editRequest(conversation.id, inbound.id, 'Tentativa');

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('MESSAGE_NOT_EDITABLE');
      expect(evolution.updated).toHaveLength(0);
      const unchanged = await prisma.message.findUniqueOrThrow({ where: { id: inbound.id } });
      expect(unchanged.content).toBe('Mensagem recebida');
    });

    it('never edits an unsupported message type', async () => {
      const { conversationId } = await seedOutbound();
      const document = await prisma.message.create({
        data: {
          tenantId: ownerA.tenantId,
          conversationId,
          direction: 'OUTBOUND',
          type: 'DOCUMENT',
          content: 'arquivo.pdf',
          externalMessageId: randomUUID(),
          status: 'SENT',
        },
      });

      const response = await editRequest(conversationId, document.id, 'novo nome');

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('MESSAGE_NOT_EDITABLE');
      expect(evolution.updated).toHaveLength(0);
    });

    it('never edits an outbound message without a provider id', async () => {
      const { conversationId } = await seedOutbound();
      const pending = await prisma.message.create({
        data: {
          tenantId: ownerA.tenantId,
          conversationId,
          direction: 'OUTBOUND',
          type: 'TEXT',
          content: 'Ainda não confirmada',
          status: 'PENDING',
        },
      });

      const response = await editRequest(conversationId, pending.id, 'nova');

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('MESSAGE_NOT_EDITABLE');
      expect(evolution.updated).toHaveLength(0);
    });

    it('never edits a message from another tenant', async () => {
      const { conversationId, messageId } = await seedOutbound();

      const response = await editRequest(conversationId, messageId, 'Ataque', ownerB);

      expect(response.statusCode).toBe(404);
      expect(evolution.updated).toHaveLength(0);
    });

    it('does not change the message when the provider rejects the edit', async () => {
      const { conversationId, messageId } = await seedOutbound();
      evolution.updateMessageError = { status: 400 };
      const emit = vi.spyOn(app.get(RealtimeService), 'emitToConversation');

      const response = await editRequest(conversationId, messageId, 'Não vai aplicar');

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('MESSAGE_NOT_EDITABLE');
      const unchanged = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(unchanged.content).toBe('Resposta do CRM');
      expect((unchanged.metadata as Record<string, unknown>).edited).toBeUndefined();
      expect(emit).not.toHaveBeenCalled();
      emit.mockRestore();
    });

    it('keeps editing idempotent without creating new messages or moving the row', async () => {
      const { conversationId, messageId } = await seedOutbound();
      const original = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      const total = await prisma.message.count({ where: { tenantId: ownerA.tenantId } });

      await editRequest(conversationId, messageId, 'Primeira edição');
      const second = await editRequest(conversationId, messageId, 'Segunda edição');

      expect(second.statusCode).toBe(200);
      const updated = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(updated.content).toBe('Segunda edição');
      expect(updated.occurredAt).toEqual(original.occurredAt);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(total);
    });

    it('rejects an empty content and an unknown message', async () => {
      const { conversationId, messageId } = await seedOutbound();

      const empty = await editRequest(conversationId, messageId, '   ');
      expect(empty.statusCode).toBe(422);

      const missing = await editRequest(conversationId, randomUUID(), 'x');
      expect(missing.statusCode).toBe(404);
      expect(missing.json().code).toBe('MESSAGE_NOT_FOUND');
      expect(evolution.updated).toHaveLength(0);
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

    it('syncs chat metadata and participants without changing inbox state or history', async () => {
      const instanceName = `group-sync-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(groupPayload(instanceName, randomUUID(), 'Olá', groupJid, participant));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const readMarker = new Date('2026-10-20T12:00:00.000Z');
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { isArchived: true, isPinned: true, lastReadAt: readMarker },
      });

      await postWebhook({
        event: 'CHATS_UPSERT',
        instance: instanceName,
        data: [{ remoteJid: groupJid, name: 'Grupo Sincronizado' }],
      });
      await postWebhook({
        event: 'GROUPS_UPSERT',
        instance: instanceName,
        data: [
          {
            id: groupJid,
            subject: 'Grupo Sincronizado',
            participants: [
              {
                id: participant,
                admin: 'admin',
                phoneNumber: '5511888888888',
                name: 'Maria',
              },
            ],
          },
        ],
      });

      const synced = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(synced.groupName).toBe('Grupo Sincronizado');
      expect(synced.isArchived).toBe(true);
      expect(synced.isPinned).toBe(true);
      expect(synced.lastReadAt?.toISOString()).toBe(readMarker.toISOString());

      const participantRow = await prisma.conversationParticipant.findUniqueOrThrow({
        where: {
          conversationId_jid: { conversationId: conversation.id, jid: participant },
        },
      });
      expect(participantRow).toMatchObject({
        tenantId: ownerA.tenantId,
        phone: '5511888888888',
        name: 'Maria',
        isAdmin: true,
        active: true,
      });

      const removed = await postWebhook({
        event: 'GROUP_PARTICIPANTS_UPDATE',
        instance: instanceName,
        data: {
          id: groupJid,
          action: 'remove',
          participants: [participant],
          participantsData: [],
        },
      });
      expect(removed.statusCode).toBe(200);
      const afterRemoval = await prisma.conversationParticipant.findUniqueOrThrow({
        where: {
          conversationId_jid: { conversationId: conversation.id, jid: participant },
        },
      });
      expect(afterRemoval.active).toBe(false);
      expect(afterRemoval.leftAt).not.toBeNull();
      expect(
        await prisma.message.count({
          where: { tenantId: ownerA.tenantId, conversationId: conversation.id },
        }),
      ).toBe(1);
    });

    it('refreshes an existing group conversation on demand', async () => {
      const instanceName = `group-refresh-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(groupPayload(instanceName, randomUUID(), 'Olá', groupJid, participant));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      evolution.groupSubject = 'Nome Atualizado';
      evolution.groupParticipants = [
        {
          id: participant,
          admin: 'superadmin',
          phoneNumber: '5511888888888',
          name: 'Maria',
        },
      ];

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
      expect(
        await prisma.conversationParticipant.findUnique({
          where: {
            conversationId_jid: { conversationId: conversation.id, jid: participant },
          },
        }),
      ).toMatchObject({ name: 'Maria', isAdmin: true, active: true });
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
    async function listMessages(conversationId: string, tenant: SeededTenant) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversationId}/messages`,
        headers: authHeaders(tenant),
      });
      expect(response.statusCode).toBe(200);
      return response.json().data as Array<{
        id: string;
        externalMessageId: string | null;
        reactions: Array<{ emoji: string; fromMe: boolean; reactorName: string | null }>;
      }>;
    }

    it('attaches a reaction to the original message without creating a message or unread item', async () => {
      const instanceName = `reaction-direct-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();

      await postWebhook(evolutionPayload(instanceName, targetId, 'Mensagem original'));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const target = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, externalMessageId: targetId },
      });
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/read`,
        headers: authHeaders(ownerA),
        payload: {},
      });
      const before = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });

      const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');
      try {
        const response = await postWebhook(
          reactionPayload(instanceName, randomUUID(), '❤️', {
            pushName: 'Contato Teste',
            targetId,
            targetFromMe: true,
          }),
        );

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          accepted: true,
          conversationId: conversation.id,
          messageId: target.id,
        });

        expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
        const reaction = await prisma.messageReaction.findFirstOrThrow({
          where: { tenantId: ownerA.tenantId },
        });
        expect(reaction).toMatchObject({
          conversationId: conversation.id,
          targetExternalId: targetId,
          targetFromMe: true,
          reactorId: '5511999999999@s.whatsapp.net',
          reactorName: 'Contato Teste',
          fromMe: false,
          emoji: '❤️',
        });

        const after = await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        });
        expect(after.lastMessageAt?.toISOString()).toBe(before.lastMessageAt?.toISOString());
        expect(after.isArchived).toBe(before.isArchived);

        const detail = await app.inject({
          method: 'GET',
          url: `/api/conversations/${conversation.id}`,
          headers: authHeaders(ownerA),
        });
        expect(detail.json()).toMatchObject({
          unreadCount: 0,
          lastMessage: { content: 'Mensagem original', direction: 'INBOUND' },
        });

        const listed = await listMessages(conversation.id, ownerA);
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
          id: target.id,
          reactions: [{ emoji: '❤️', fromMe: false, reactorName: 'Contato Teste' }],
        });

        expect(emit).toHaveBeenCalledWith(
          ownerA.tenantId,
          'message.reaction',
          expect.objectContaining({
            conversationId: conversation.id,
            messageId: target.id,
            reactions: [expect.objectContaining({ emoji: '❤️' })],
          }),
        );
        expect(emit).not.toHaveBeenCalledWith(
          ownerA.tenantId,
          'message.created',
          expect.anything(),
        );
      } finally {
        emit.mockRestore();
      }
    });

    it('attributes a group reaction to its participant', async () => {
      const instanceName = `reaction-group-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const groupJid = '120363222222222222@g.us';
      const participant = '5511888888888@lid';
      const participantAlt = '5511888888888@s.whatsapp.net';
      const targetId = randomUUID();

      await postWebhook(
        groupPayload(
          instanceName,
          targetId,
          'Mensagem do grupo',
          groupJid,
          participantAlt,
          'Maria',
        ),
      );
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
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, isGroup: true },
      });
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);

      const reaction = await prisma.messageReaction.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(reaction).toMatchObject({
        conversationId: conversation.id,
        targetExternalId: targetId,
        targetFromMe: true,
        reactorId: participant,
        reactorName: 'Maria',
        fromMe: false,
        emoji: '😂',
      });

      const listed = await listMessages(conversation.id, ownerA);
      expect(listed[0].reactions).toEqual([
        expect.objectContaining({ emoji: '😂', reactorName: 'Maria' }),
      ]);
    });

    it('attributes a reaction sent by the connected phone to the operator', async () => {
      const instanceName = `reaction-self-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();

      await postWebhook(evolutionPayload(instanceName, targetId, 'Recebida'));
      await postWebhook(
        reactionPayload(instanceName, randomUUID(), '👍', {
          targetId,
          fromMe: true,
          pushName: 'Atendente',
        }),
      );

      const reaction = await prisma.messageReaction.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(reaction).toMatchObject({
        reactorId: 'self',
        reactorName: null,
        fromMe: true,
        emoji: '👍',
      });

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const listed = await listMessages(conversation.id, ownerA);
      expect(listed[0].reactions).toEqual([expect.objectContaining({ emoji: '👍', fromMe: true })]);
    });

    it('replaces the emoji when the same author changes the reaction', async () => {
      const instanceName = `reaction-change-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();

      await postWebhook(evolutionPayload(instanceName, targetId, 'Mensagem'));
      await postWebhook(reactionPayload(instanceName, randomUUID(), '❤️', { targetId }));
      await postWebhook(reactionPayload(instanceName, randomUUID(), '🔥', { targetId }));

      const reactions = await prisma.messageReaction.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(reactions).toHaveLength(1);
      expect(reactions[0].emoji).toBe('🔥');
    });

    it('removes the reaction when the provider sends an empty emoji', async () => {
      const instanceName = `reaction-remove-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();

      await postWebhook(evolutionPayload(instanceName, targetId, 'Mensagem'));
      await postWebhook(reactionPayload(instanceName, randomUUID(), '❤️', { targetId }));
      const response = await postWebhook(
        reactionPayload(instanceName, randomUUID(), '', { targetId }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json().ignored).toBe('reaction_removed');
      expect(await prisma.messageReaction.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('keeps a reaction whose target has not been synchronized yet', async () => {
      const instanceName = `reaction-pending-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();

      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Outra mensagem'));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const response = await postWebhook(
        reactionPayload(instanceName, randomUUID(), '😮', { targetId }),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);

      await postWebhook(evolutionPayload(instanceName, targetId, 'Chegou depois'));
      const listed = await listMessages(conversation.id, ownerA);
      const target = listed.find((message) => message.externalMessageId === targetId);
      expect(target?.reactions).toEqual([expect.objectContaining({ emoji: '😮' })]);
    });

    it('does not create a conversation for a reaction without a known conversation', async () => {
      const instanceName = `reaction-orphan-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const response = await postWebhook(
        reactionPayload(instanceName, randomUUID(), '👍', { targetId: randomUUID() }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json().ignored).toBe('reaction_unknown_conversation');
      expect(await prisma.conversation.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
      expect(await prisma.messageReaction.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
    });

    it('is idempotent when the same reaction webhook is delivered twice', async () => {
      const instanceName = `reaction-retry-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();

      await postWebhook(evolutionPayload(instanceName, targetId, 'Mensagem'));
      const payload = reactionPayload(instanceName, randomUUID(), '👍', { targetId });
      await postWebhook(payload);
      const duplicate = await postWebhook(payload);

      expect(duplicate.json().ignored).toBe('duplicate_event');
      expect(await prisma.messageReaction.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
    });

    it('never attaches a reaction to a message from another tenant', async () => {
      const instanceA = `reaction-tenant-a-${randomUUID()}`;
      const instanceB = `reaction-tenant-b-${randomUUID()}`;
      await createInstance(ownerA, instanceA);
      await createInstance(ownerB, instanceB);
      const targetId = randomUUID();

      await postWebhook(evolutionPayload(instanceA, targetId, 'Mensagem do tenant A'));
      await postWebhook(evolutionPayload(instanceB, randomUUID(), 'Mensagem do tenant B'));

      const response = await postWebhook(
        reactionPayload(instanceB, randomUUID(), '🔥', { targetId }),
      );

      expect(response.statusCode).toBe(200);
      expect(await prisma.messageReaction.count({ where: { tenantId: ownerB.tenantId } })).toBe(1);
      expect(await prisma.messageReaction.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);

      await postWebhook(evolutionPayload(instanceB, targetId, 'Mensagem do tenant B'));
      const conversationA = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const conversationB = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerB.tenantId },
      });
      const messagesA = await listMessages(conversationA.id, ownerA);
      const messagesB = await listMessages(conversationB.id, ownerB);
      expect(messagesA.flatMap((message) => message.reactions)).toHaveLength(0);
      expect(
        messagesB.find((message) => message.externalMessageId === targetId)?.reactions,
      ).toEqual([expect.objectContaining({ emoji: '🔥' })]);
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
      for (const [providerState, expectedState] of [
        ['composing', 'composing'],
        ['paused', 'online'],
        ['composing', 'composing'],
        ['recording', 'recording'],
        ['unavailable', 'offline'],
      ] as const) {
        const response = await postWebhook({
          event: 'presence.update',
          instance: instanceName,
          data: { id: jid, presences: { [jid]: { lastKnownPresence: providerState } } },
        });
        expect(response.statusCode).toBe(200);
        expect(emit).toHaveBeenLastCalledWith(
          ownerA.tenantId,
          'conversation.presence',
          expect.objectContaining({
            conversationId: conversation.id,
            participantId: jid,
            state: expectedState,
          }),
        );
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

  it('resolves a group @lid activity indicator from the sender data already stored', async () => {
    const instanceName = `presence-lid-${randomUUID()}`;
    const groupJid = '120363444444444444@g.us';
    const participant = '63604221026389@lid';
    await createInstance(ownerA, instanceName);
    await postWebhook(
      groupPayload(instanceName, randomUUID(), 'Olá', groupJid, participant, 'Ernandes Lourenço'),
    );
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId, isGroup: true },
    });
    const emit = vi.spyOn(app.get(RealtimeService), 'emitToTenant');
    try {
      const response = await postWebhook({
        event: 'presence.update',
        instance: instanceName,
        data: {
          id: groupJid,
          presences: { [participant]: { lastKnownPresence: 'recording' } },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(emit).toHaveBeenLastCalledWith(
        ownerA.tenantId,
        'conversation.presence',
        expect.objectContaining({
          conversationId: conversation.id,
          participantId: participant,
          participantName: 'Ernandes Lourenço',
          state: 'recording',
        }),
      );
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

    it('sends to the LID when the conversation is addressed by a LID', async () => {
      const instanceName = `lid-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'oi', '75209205874877@lid'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.externalContactId).toBe('75209205874877@lid');
      expect(conversation.externalLid).toBe('75209205874877@lid');
      expect(conversation.contactId).toBeNull();

      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Olá' },
      });

      expect(evolution.sent).toHaveLength(1);
      expect(evolution.sent[0].number).toBe('75209205874877@lid');
    });

    it('captures the LID from remoteJidAlt and prefers it over the phone when sending', async () => {
      const instanceName = `pn-lid-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(
        evolutionPayload(
          instanceName,
          randomUUID(),
          'oi',
          '5511888888888@s.whatsapp.net',
          '75209205874877@lid',
        ),
      );

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.externalContactId).toBe('5511888888888@s.whatsapp.net');
      expect(conversation.externalLid).toBe('75209205874877@lid');
      expect(conversation.contactId).not.toBeNull();

      const contact = await prisma.contact.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(contact.phone).toBe('5511888888888');

      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Olá' },
      });

      expect(evolution.sent).toHaveLength(1);
      expect(evolution.sent[0].number).toBe('75209205874877@lid');
    });

    it('falls back to the phone when the provider reports ERROR for the LID', async () => {
      const instanceName = `pn-lid-fallback-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(
        evolutionPayload(
          instanceName,
          randomUUID(),
          'oi',
          '5511888888888@s.whatsapp.net',
          '75209205874877@lid',
        ),
      );

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation.externalLid).toBe('75209205874877@lid');

      await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Olá' },
      });

      // The default prefers the LID.
      expect(evolution.sent.at(-1)?.number).toBe('75209205874877@lid');
      const outbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'desc' },
      });
      const externalMessageId = outbound.externalMessageId as string;
      expect(externalMessageId).toBeTruthy();

      await postWebhook({
        event: 'messages.update',
        instance: instanceName,
        data: {
          keyId: externalMessageId,
          remoteJid: conversation.externalContactId,
          fromMe: true,
          status: 'ERROR',
        },
      });

      // The conversation learns the phone works and the same message is resent to it.
      const reloaded = await prisma.conversation.findFirstOrThrow({
        where: { id: conversation.id },
      });
      expect(reloaded.preferredAddress).toBe('PN');
      expect(evolution.sent.at(-1)?.number).toBe('5511888888888');
      const resent = await prisma.message.findUniqueOrThrow({ where: { id: outbound.id } });
      expect(resent.status).toBe('SENT');
      expect(resent.externalMessageId).not.toBe(externalMessageId);
    });

    it('blocks the send and persists nothing when the instance is not connected', async () => {
      const instanceName = `not-connected-${randomUUID()}`;
      await createInstance(ownerA, instanceName, 'DISCONNECTED');
      await postWebhook(evolutionPayload(instanceName, randomUUID(), 'oi'));

      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Olá' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('WHATSAPP_INSTANCE_NOT_CONNECTED');
      expect(evolution.sent).toHaveLength(0);
      const outbound = await prisma.message.count({
        where: { tenantId: ownerA.tenantId, direction: 'OUTBOUND' },
      });
      expect(outbound).toBe(0);
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
      const pinnedOld = await createConversation(
        ownerA,
        instanceName,
        '5511900000010@s.whatsapp.net',
        {
          isPinned: true,
          lastMessageAt: new Date(base - 10_000),
        },
      );
      const recent = await createConversation(
        ownerA,
        instanceName,
        '5511900000011@s.whatsapp.net',
        {
          lastMessageAt: new Date(base),
        },
      );
      const older = await createConversation(ownerA, instanceName, '5511900000012@s.whatsapp.net', {
        lastMessageAt: new Date(base - 20_000),
      });
      const noMessage = await createConversation(
        ownerA,
        instanceName,
        '5511900000013@s.whatsapp.net',
        {
          lastMessageAt: null,
        },
      );

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
      const conversationId = await createConversation(instanceName, '5511901000001@s.whatsapp.net');

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
      const conversationId = await createConversation(instanceName, '5511901000002@s.whatsapp.net');

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
      const conversationId = await createConversation(instanceName, '5511901000060@s.whatsapp.net');

      const response = await archive(conversationId, ownerB);
      expect(response.statusCode).toBe(404);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(stored.isArchived).toBe(false);
    });

    it('rejects an unauthenticated archive and returns 404 for unknown conversations', async () => {
      const instanceName = await seedInstance();
      const conversationId = await createConversation(instanceName, '5511901000070@s.whatsapp.net');

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
      const conversationId = await createConversation(instanceName, '5511901000080@s.whatsapp.net');
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

  describe('contact identity resolution (LID regression)', () => {
    const PHONE = '556192468074';
    const PHONE_JID = `${PHONE}@s.whatsapp.net`;
    const LID = '86840027656376@lid';

    function lidPayload(
      instanceName: string,
      messageId: string,
      text: string,
      options: {
        lid?: string;
        phone?: string | null;
        fromMe?: boolean;
        pushName?: string;
        groupJid?: string;
        participant?: string;
      } = {},
    ) {
      const {
        lid = LID,
        phone = null,
        fromMe = false,
        pushName = 'Atendente',
        groupJid,
        participant,
      } = options;
      const remoteJid = groupJid ?? (phone ? `${phone}@s.whatsapp.net` : lid);
      return {
        event: 'messages.upsert',
        instance: instanceName,
        data: {
          key: {
            id: messageId,
            fromMe,
            remoteJid,
            participant: participant ?? '',
            ...(phone && !groupJid ? { remoteJidAlt: lid } : {}),
            ...(participant ? { participantAlt: PHONE_JID } : {}),
            addressingMode: phone && !groupJid ? 'pn' : 'lid',
          },
          pushName,
          message: { conversation: text },
          messageType: 'conversation',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      };
    }

    it('links an inbound message to an already registered contact by its phone', async () => {
      const instanceName = `lid-known-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const contact = await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, phone: PHONE, name: 'Mãe' },
      });

      await postWebhook(lidPayload(instanceName, randomUUID(), 'Bom dia', { phone: PHONE }));
      await postWebhook(lidPayload(instanceName, randomUUID(), 'Tudo bem?', { phone: PHONE }));

      const contacts = await prisma.contact.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(contacts).toHaveLength(1);
      expect(contacts[0].id).toBe(contact.id);
      expect(contacts[0].name).toBe('Mãe');

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({
        externalContactId: PHONE_JID,
        externalLid: LID,
        contactId: contact.id,
      });

      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(messages).toHaveLength(2);
      expect(messages.every((message) => message.conversationId === conversations[0].id)).toBe(
        true,
      );
    });

    it('keeps a message sent from the phone addressed only by LID in the existing phone conversation', async () => {
      const instanceName = `lid-regression-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      // Evolution 2.4 swaps remoteJid/remoteJidAlt for an inbound LID chat, so
      // the phone conversation is created first and records the LID.
      await postWebhook(lidPayload(instanceName, randomUUID(), 'Bom dia', { phone: PHONE }));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const contact = await prisma.contact.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { subject: 'Histórico da Mãe' },
      });
      const tag = await prisma.tag.create({
        data: { tenantId: ownerA.tenantId, name: 'Família' },
      });
      await prisma.conversationTag.create({
        data: { tenantId: ownerA.tenantId, conversationId: conversation.id, tagId: tag.id },
      });

      // The message the user sent from the phone: LID only, no remoteJidAlt.
      const response = await postWebhook(
        lidPayload(instanceName, '3EB05042A5A5931A5F5C4B', 'vamos', { fromMe: true }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        accepted: true,
        conversationId: conversation.id,
      });

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({
        id: conversation.id,
        externalContactId: PHONE_JID,
        externalLid: LID,
        contactId: contact.id,
        subject: 'Histórico da Mãe',
      });

      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { createdAt: 'asc' },
      });
      expect(messages).toHaveLength(2);
      expect(messages.map((message) => message.content)).toEqual(['Bom dia', 'vamos']);
      expect(messages.every((message) => message.conversationId === conversation.id)).toBe(true);
      const sentFromPhone = messages[1];
      expect(sentFromPhone).toMatchObject({ direction: 'OUTBOUND', status: 'SENT' });
      expect(sentFromPhone.metadata).toMatchObject({ remoteJid: LID });

      expect(await prisma.contact.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(
        await prisma.conversationTag.count({
          where: { tenantId: ownerA.tenantId, conversationId: conversation.id, tagId: tag.id },
        }),
      ).toBe(1);
    });

    it('does not turn a LID into a phone when no association was ever recorded', async () => {
      const instanceName = `lid-unknown-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      // A coincidental contact whose phone matches the LID digits must stay separate.
      const unrelated = await prisma.contact.create({
        data: { tenantId: ownerA.tenantId, phone: '86840027656376', name: 'Outro contato' },
      });

      const response = await postWebhook(
        lidPayload(instanceName, randomUUID(), 'Enviada para um LID', { fromMe: true }),
      );

      expect(response.statusCode).toBe(200);
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversation).toMatchObject({
        externalContactId: LID,
        externalLid: LID,
        contactId: null,
      });
      expect(await prisma.contact.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      const stored = await prisma.contact.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(stored.id).toBe(unrelated.id);
      const message = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(message.conversationId).toBe(conversation.id);
      expect(message.metadata).toMatchObject({ remoteJid: LID });
    });

    it('reconciles a message sent by the CRM when the provider echoes it addressed by LID', async () => {
      const instanceName = `lid-crm-echo-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(lidPayload(instanceName, randomUUID(), 'Bom dia', { phone: PHONE }));
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });

      const sent = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: authHeaders(ownerA),
        payload: { content: 'Resposta enviada pelo CRM' },
      });
      expect(sent.statusCode).toBe(201);
      expect(evolution.sent[0]?.number).toBe(LID);
      const outbound = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, direction: 'OUTBOUND' },
      });

      const echo = await postWebhook(
        lidPayload(
          instanceName,
          outbound.externalMessageId as string,
          'Resposta enviada pelo CRM',
          {
            fromMe: true,
          },
        ),
      );

      expect(echo.json()).toMatchObject({
        ignored: 'reconciled_message',
        conversationId: conversation.id,
        messageId: outbound.id,
      });
      expect(await prisma.conversation.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(2);
    });

    it('keeps the group identity and the participant identity of a LID group message', async () => {
      const instanceName = `lid-group-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const groupJid = '120363000000000777@g.us';
      const participant = '229428613357801@lid';

      await postWebhook(
        lidPayload(instanceName, randomUUID(), 'Mensagem no grupo', {
          fromMe: false,
          groupJid,
          participant,
          pushName: 'Participante',
        }),
      );
      await postWebhook(
        lidPayload(instanceName, randomUUID(), 'Outra mensagem', { groupJid, fromMe: true }),
      );

      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({
        externalContactId: groupJid,
        isGroup: true,
        contactId: null,
      });
      expect(await prisma.contact.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);

      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { createdAt: 'asc' },
      });
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ senderId: participant, senderName: 'Participante' });
      expect(messages[1]).toMatchObject({ direction: 'OUTBOUND', senderId: null });
      expect(messages.every((message) => message.conversationId === conversations[0].id)).toBe(
        true,
      );
    });

    it('does not create conversations for message update or edit events', async () => {
      const instanceName = `lid-updates-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const update = await postWebhook({
        event: 'messages.update',
        instance: instanceName,
        data: [{ keyId: randomUUID(), remoteJid: LID, fromMe: true, status: 'DELIVERED' }],
      });
      const edit = await postWebhook({
        event: 'messages.edited',
        instance: instanceName,
        data: [
          {
            key: { id: randomUUID(), remoteJid: LID, fromMe: true },
            editedMessage: { conversation: 'texto editado' },
          },
        ],
      });

      expect(update.statusCode).toBe(200);
      expect(edit.statusCode).toBe(200);
      expect(await prisma.conversation.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(0);
    });

    it('is idempotent when the same LID webhook is delivered twice', async () => {
      const instanceName = `lid-duplicate-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      await postWebhook(lidPayload(instanceName, randomUUID(), 'Bom dia', { phone: PHONE }));

      const payload = lidPayload(instanceName, randomUUID(), 'vamos', { fromMe: true });
      await postWebhook(payload);
      const duplicate = await postWebhook(payload);

      expect(duplicate.json().ignored).toBe('duplicate_event');
      expect(await prisma.conversation.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(
        await prisma.message.count({ where: { tenantId: ownerA.tenantId, content: 'vamos' } }),
      ).toBe(1);
    });

    it('serializes concurrent events for the same new contact into one conversation', async () => {
      const instanceName = `lid-concurrent-${randomUUID()}`;
      await createInstance(ownerA, instanceName);

      const [first, second] = await Promise.all([
        postWebhook(
          lidPayload(instanceName, randomUUID(), 'Primeira', { fromMe: false, phone: PHONE }),
        ),
        postWebhook(
          lidPayload(instanceName, randomUUID(), 'Segunda', { fromMe: false, phone: PHONE }),
        ),
      ]);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(await prisma.contact.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(conversations).toHaveLength(1);
      const messages = await prisma.message.findMany({
        where: { tenantId: ownerA.tenantId },
      });
      expect(messages).toHaveLength(2);
      expect(messages.every((message) => message.conversationId === conversations[0].id)).toBe(
        true,
      );
    });

    it('keeps similar phone numbers as distinct contacts and conversations', async () => {
      const instanceName = `lid-similar-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const firstPhone = '5511988888888';
      const secondPhone = '5511988888889';

      await postWebhook(
        lidPayload(instanceName, randomUUID(), 'Primeiro número', {
          fromMe: false,
          phone: firstPhone,
          lid: '11111111111111@lid',
        }),
      );
      await postWebhook(
        lidPayload(instanceName, randomUUID(), 'Segundo número', {
          fromMe: false,
          phone: secondPhone,
          lid: '22222222222222@lid',
        }),
      );

      const contacts = await prisma.contact.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { phone: 'asc' },
      });
      expect(contacts.map((contact) => contact.phone)).toEqual([firstPhone, secondPhone]);
      const conversations = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { externalContactId: 'asc' },
      });
      expect(conversations).toHaveLength(2);
      expect(conversations.map((conversation) => conversation.externalContactId)).toEqual([
        `${firstPhone}@s.whatsapp.net`,
        `${secondPhone}@s.whatsapp.net`,
      ]);
      expect(
        conversations.find((conversation) => conversation.contactId === contacts[0].id),
      ).toBeDefined();
      expect(
        conversations.find((conversation) => conversation.contactId === contacts[1].id),
      ).toBeDefined();
    });

    it('scopes the LID association to the tenant and to the instance', async () => {
      const instanceA1 = `lid-scope-a1-${randomUUID()}`;
      const instanceA2 = `lid-scope-a2-${randomUUID()}`;
      const instanceB = `lid-scope-b-${randomUUID()}`;
      await createInstance(ownerA, instanceA1);
      await createInstance(ownerA, instanceA2);
      await createInstance(ownerB, instanceB);

      await postWebhook(lidPayload(instanceA1, randomUUID(), 'Bom dia', { phone: PHONE }));
      await postWebhook(lidPayload(instanceA2, randomUUID(), 'Outra instância', { fromMe: true }));
      await postWebhook(lidPayload(instanceB, randomUUID(), 'Outro tenant', { fromMe: true }));

      const conversationsA = await prisma.conversation.findMany({
        where: { tenantId: ownerA.tenantId },
        orderBy: { externalContactId: 'asc' },
      });
      expect(conversationsA).toHaveLength(2);
      const conversationsB = await prisma.conversation.findMany({
        where: { tenantId: ownerB.tenantId },
      });
      expect(conversationsB).toHaveLength(1);
      expect(conversationsB[0]).toMatchObject({
        externalContactId: LID,
        contactId: null,
      });
      expect(await prisma.contact.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(await prisma.contact.count({ where: { tenantId: ownerB.tenantId } })).toBe(0);
      const messagesB = await prisma.message.findMany({
        where: { tenantId: ownerB.tenantId },
      });
      expect(messagesB).toHaveLength(1);
      expect(messagesB[0].conversationId).toBe(conversationsB[0].id);
    });

    it('attaches a reaction addressed by LID to the phone conversation', async () => {
      const instanceName = `lid-reaction-${randomUUID()}`;
      await createInstance(ownerA, instanceName);
      const targetId = randomUUID();
      await postWebhook(
        lidPayload(instanceName, targetId, 'Mensagem original', { fromMe: false, phone: PHONE }),
      );
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      const target = await prisma.message.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId, externalMessageId: targetId },
      });

      const response = await postWebhook(
        reactionPayload(instanceName, randomUUID(), '❤️', {
          remoteJid: LID,
          fromMe: true,
          targetId,
          targetFromMe: false,
        }),
      );

      expect(response.json()).toMatchObject({
        accepted: true,
        conversationId: conversation.id,
        messageId: target.id,
      });
      expect(await prisma.conversation.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
      const reaction = await prisma.messageReaction.findFirstOrThrow({
        where: { tenantId: ownerA.tenantId },
      });
      expect(reaction).toMatchObject({
        conversationId: conversation.id,
        targetExternalId: targetId,
        fromMe: true,
        reactorId: 'self',
        emoji: '❤️',
      });
    });
  });
});
