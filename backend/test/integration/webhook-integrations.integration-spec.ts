import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { EvolutionRequestError } from '../../src/modules/whatsapp/evolution/evolution.client.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

const GROUP_JID = '120363000000000000@g.us';
const WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET ?? 'test-webhook-secret';

class FakeEvolution {
  configured = true;
  readonly sent: { instance: string; number: string; text: string }[] = [];
  failWith?: EvolutionRequestError;
  groupSubject: string | null = 'Grupo Notificações';
  private counter = 0;

  async findGroupInfos(_instance: string, groupJid: string) {
    if (!groupJid.endsWith('@g.us')) {
      return null;
    }
    return {
      groupJid,
      subject: this.groupSubject,
      pictureUrl: 'https://cdn.example/group.jpg',
      size: 3,
    };
  }

  async findGroups() {
    return [
      {
        groupJid: GROUP_JID,
        subject: this.groupSubject,
        pictureUrl: 'https://cdn.example/group.jpg',
        size: 3,
      },
    ];
  }

  async sendText(instance: string, number: string, text: string) {
    if (this.failWith) {
      throw this.failWith;
    }
    this.counter += 1;
    this.sent.push({ instance, number, text });
    return { externalMessageId: `integration-${this.counter}`, raw: {} };
  }
}

const evolution = new FakeEvolution();

describe('Webhook integrations (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
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
    evolution.failWith = undefined;
    evolution.groupSubject = 'Grupo Notificações';
    ownerA = await seedTenant(app, prisma, { name: 'Webhook Org A', role: 'OWNER' });
    ownerB = await seedTenant(app, prisma, { name: 'Webhook Org B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, ownerB]);
  });

  async function createInstance(tenant: SeededTenant): Promise<string> {
    const instance = await prisma.whatsAppInstance.create({
      data: {
        tenantId: tenant.tenantId,
        name: `Instância ${randomUUID()}`,
        instanceName: `webhook-inst-${randomUUID()}`,
        status: 'CONNECTED',
        active: true,
      },
      select: { id: true, instanceName: true },
    });
    return instance.id;
  }

  async function createWebhook(
    tenant: SeededTenant,
    instanceId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      headers: authHeaders(tenant),
      payload: {
        name: 'Integração de teste',
        whatsappInstanceId: instanceId,
        groupJid: GROUP_JID,
        ...overrides,
      },
    });
  }

  function execute(id: string, secret: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/api/integrations/webhooks/${id}/execute`,
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      payload,
    });
  }

  it('creates an integration returning the secret once and isolates organizations', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);

    expect(created.statusCode).toBe(201);
    expect(created.json().secret).toMatch(/^whk_/);
    expect(created.json().groupJid).toBe(GROUP_JID);
    expect(created.json().groupName).toBe('Grupo Notificações');
    expect(created.json()).not.toHaveProperty('secretHash');

    const listA = await app.inject({
      method: 'GET',
      url: '/api/integrations/webhooks',
      headers: authHeaders(ownerA),
    });
    expect(listA.json().data).toHaveLength(1);
    expect(listA.json().data[0]).not.toHaveProperty('secret');

    const listB = await app.inject({
      method: 'GET',
      url: '/api/integrations/webhooks',
      headers: authHeaders(ownerB),
    });
    expect(listB.json().data).toHaveLength(0);

    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/integrations/webhooks/${created.json().id}`,
      headers: authHeaders(ownerB),
    });
    expect(foreignRead.statusCode).toBe(404);
  });

  it('does not allow using an instance from another organization', async () => {
    const instanceA = await createInstance(ownerA);

    const response = await createWebhook(ownerB, instanceA);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('WEBHOOK_INSTANCE_UNAVAILABLE');
  });

  it('rejects an arbitrary destination that is not a group', async () => {
    const instanceId = await createInstance(ownerA);

    const response = await createWebhook(ownerA, instanceId, {
      groupJid: '5511999999999@s.whatsapp.net',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('BAD_REQUEST');
  });

  it('executes with the configured instance/group, persists the group conversation and is idempotent with the Evolution event', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);
    const secret = created.json().secret as string;

    const response = await execute(created.json().id, secret, { message: 'Olá, grupo!' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'SUCCESS',
      externalMessageId: 'integration-1',
    });
    expect(evolution.sent).toEqual([
      expect.objectContaining({ number: GROUP_JID, text: 'Olá, grupo!' }),
    ]);

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(conversation.isGroup).toBe(true);
    expect(conversation.externalContactId).toBe(GROUP_JID);
    expect(conversation.groupName).toBe('Grupo Notificações');

    const message = await prisma.message.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(message.direction).toBe('OUTBOUND');
    expect(message.externalMessageId).toBe('integration-1');

    const history = await app.inject({
      method: 'GET',
      url: `/api/integrations/webhooks/${created.json().id}/executions`,
      headers: authHeaders(ownerA),
    });
    expect(history.json().data[0]).toMatchObject({
      status: 'SUCCESS',
      externalMessageId: 'integration-1',
    });

    const evolutionEvent = await app.inject({
      method: 'POST',
      url: `/api/webhooks/evolution?token=${WEBHOOK_SECRET}`,
      payload: {
        event: 'messages.upsert',
        instance: await prisma.whatsAppInstance
          .findUniqueOrThrow({ where: { id: instanceId }, select: { instanceName: true } })
          .then((row) => row.instanceName),
        data: {
          key: { remoteJid: GROUP_JID, fromMe: true, id: 'integration-1' },
          message: { conversation: 'Olá, grupo!' },
        },
      },
    });
    expect(evolutionEvent.statusCode).toBe(200);
    expect(evolutionEvent.json().ignored).toBe('reconciled_message');

    const messages = await prisma.message.count({ where: { tenantId: ownerA.tenantId } });
    expect(messages).toBe(1);
  });

  it('rejects an invalid credential and an inactive integration', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);
    const id = created.json().id as string;

    const unauthorized = await execute(id, 'wrong-secret', { message: 'Olá' });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().code).toBe('WEBHOOK_UNAUTHORIZED');

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/integrations/webhooks/${id}`,
      headers: authHeaders(ownerA),
      payload: { active: false },
    });
    expect(disabled.statusCode).toBe(200);

    const inactive = await execute(id, created.json().secret as string, { message: 'Olá' });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().code).toBe('WEBHOOK_INTEGRATION_INACTIVE');
    expect(evolution.sent).toHaveLength(0);
  });

  it('blocks cadastro, consulta e execução when the webhooks module is disabled', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);
    const id = created.json().id as string;
    const secret = created.json().secret as string;

    const module = await prisma.module.findUniqueOrThrow({ where: { key: 'webhooks' } });
    await prisma.tenantModule.create({
      data: { tenantId: ownerA.tenantId, moduleId: module.id, enabled: false },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/integrations/webhooks',
      headers: authHeaders(ownerA),
    });
    expect(list.statusCode).toBe(403);
    expect(list.json().code).toBe('MODULE_DISABLED');

    const execution = await execute(id, secret, { message: 'Olá' });
    expect(execution.statusCode).toBe(403);
    expect(execution.json().code).toBe('MODULE_DISABLED');
    expect(evolution.sent).toHaveLength(0);
  });

  it('records a sanitized provider failure without persisting a message', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);
    evolution.failWith = new EvolutionRequestError('provider token leaked?', 500);

    const response = await execute(created.json().id, created.json().secret as string, {
      message: 'Vai falhar',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('WEBHOOK_PROVIDER_ERROR');
    expect(evolution.sent).toHaveLength(0);

    const execution = await prisma.webhookExecution.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(execution.status).toBe('FAILED');
    expect(execution.errorCode).toBe('EVOLUTION_HTTP_500');
    expect(execution.errorMessage).not.toContain('token');

    const messages = await prisma.message.count({ where: { tenantId: ownerA.tenantId } });
    expect(messages).toBe(0);
  });

  it('rejects invalid and oversized payloads', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);
    const id = created.json().id as string;
    const secret = created.json().secret as string;

    const empty = await execute(id, secret, { message: '' });
    expect(empty.statusCode).toBe(400);

    const extra = await execute(id, secret, { message: 'Olá', groupJid: GROUP_JID });
    expect(extra.statusCode).toBe(400);

    const oversized = await execute(id, secret, { message: 'x'.repeat(4097) });
    expect(oversized.statusCode).toBe(400);
    expect(evolution.sent).toHaveLength(0);
  });

  it('supports idempotency keys without sending twice', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);
    const id = created.json().id as string;
    const secret = created.json().secret as string;

    const first = await app.inject({
      method: 'POST',
      url: `/api/integrations/webhooks/${id}/execute`,
      headers: {
        authorization: `Bearer ${secret}`,
        'idempotency-key': 'external-order-1',
      },
      payload: { message: 'Uma vez' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/integrations/webhooks/${id}/execute`,
      headers: {
        authorization: `Bearer ${secret}`,
        'idempotency-key': 'external-order-1',
      },
      payload: { message: 'Uma vez' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().executionId).toBe(first.json().executionId);
    expect(evolution.sent).toHaveLength(1);
    expect(await prisma.message.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
  });

  it('soft deletes integrations and keeps them out of the list', async () => {
    const instanceId = await createInstance(ownerA);
    const created = await createWebhook(ownerA, instanceId);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/integrations/webhooks/${created.json().id}`,
      headers: authHeaders(ownerA),
    });
    expect(removed.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: '/api/integrations/webhooks',
      headers: authHeaders(ownerA),
    });
    expect(list.json().data).toHaveLength(0);

    const stored = await prisma.webhookIntegration.findUniqueOrThrow({
      where: { id: created.json().id },
    });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.active).toBe(false);
  });
});
