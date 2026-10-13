import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../src/infrastructure/realtime/realtime.service.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

interface ConversationListItem {
  id: string;
  unreadCount: number;
}

describe('Unread conversations (integration)', () => {
  let harness: TestApp;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let memberA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    harness = await createTestApp();
    prisma = harness.prisma;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    ownerA = await seedTenant(harness.app, prisma, { name: 'Unread Owner A', role: 'OWNER' });
    memberA = await seedMember(harness.app, prisma, ownerA.tenantId, {
      name: 'Unread Member A',
      role: 'USER',
    });
    ownerB = await seedTenant(harness.app, prisma, { name: 'Unread Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, memberA, ownerB]);
  });

  async function seedInstance(tenant: SeededTenant): Promise<string> {
    const instance = await prisma.whatsAppInstance.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Loja',
        instanceName: `unread-${randomUUID()}`,
        status: 'CONNECTED',
        active: true,
      },
      select: { id: true },
    });
    return instance.id;
  }

  async function createConversation(
    tenant: SeededTenant,
    instanceId: string,
    jid: string,
    options: { lastReadAt?: Date | null; isArchived?: boolean } = {},
  ): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.tenantId,
        whatsappInstanceId: instanceId,
        externalContactId: jid,
        isGroup: false,
        status: 'OPEN',
        isArchived: options.isArchived ?? false,
        ...(options.lastReadAt !== undefined ? { lastReadAt: options.lastReadAt } : {}),
      },
      select: { id: true },
    });
    return conversation.id;
  }

  async function createMessage(input: {
    tenantId: string;
    conversationId: string;
    direction: 'INBOUND' | 'OUTBOUND';
    occurredAt?: Date;
  }): Promise<string> {
    const message = await prisma.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        direction: input.direction,
        type: 'TEXT',
        content: 'oi',
        status: input.direction === 'INBOUND' ? 'RECEIVED' : 'SENT',
        occurredAt: input.occurredAt ?? new Date(),
      },
      select: { id: true },
    });
    return message.id;
  }

  function listConversations(tenant: SeededTenant, query = '') {
    return harness.app.inject({
      method: 'GET',
      url: `/api/conversations${query}`,
      headers: authHeaders(tenant),
    });
  }

  function markRead(tenant: SeededTenant, conversationId: string) {
    return harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/read`,
      headers: authHeaders(tenant),
    });
  }

  function unreadTotal(tenant: SeededTenant) {
    return harness.app.inject({
      method: 'GET',
      url: '/api/conversations/unread-count',
      headers: authHeaders(tenant),
    });
  }

  function evolutionPayload(instanceName: string, messageId: string, text: string) {
    return {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: messageId },
        pushName: 'Contato Teste',
        message: { conversation: text },
      },
    };
  }

  function postWebhook(payload: object) {
    const token = process.env.EVOLUTION_WEBHOOK_SECRET ?? 'test-webhook-secret';
    return harness.app.inject({
      method: 'POST',
      url: `/api/webhooks/evolution?token=${token}`,
      payload,
    });
  }

  async function unreadOf(tenant: SeededTenant, conversationId: string): Promise<number> {
    const response = await listConversations(tenant);
    const item = (response.json().data as ConversationListItem[]).find(
      (entry) => entry.id === conversationId,
    );
    return item?.unreadCount ?? -1;
  }

  it('marks a conversation as read and persists the marker', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511900000001@s.whatsapp.net',
    );
    const t0 = new Date(Date.now() - 60_000);
    await createMessage({
      tenantId: ownerA.tenantId,
      conversationId,
      direction: 'INBOUND',
      occurredAt: t0,
    });
    await createMessage({
      tenantId: ownerA.tenantId,
      conversationId,
      direction: 'INBOUND',
      occurredAt: new Date(t0.getTime() + 1_000),
    });

    expect(await unreadOf(ownerA, conversationId)).toBe(2);

    const response = await markRead(ownerA, conversationId);
    expect(response.statusCode).toBe(200);
    expect(response.json().unreadCount).toBe(0);

    expect(await unreadOf(ownerA, conversationId)).toBe(0);
  });

  it('is idempotent when marking a conversation as read repeatedly', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511900000002@s.whatsapp.net',
    );
    await createMessage({
      tenantId: ownerA.tenantId,
      conversationId,
      direction: 'INBOUND',
      occurredAt: new Date(Date.now() - 1_000),
    });

    const first = await markRead(ownerA, conversationId);
    expect(first.statusCode).toBe(200);
    const firstMarker = (
      await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    ).lastReadAt?.toISOString();

    const second = await markRead(ownerA, conversationId);
    expect(second.statusCode).toBe(200);
    expect(second.json().unreadCount).toBe(0);

    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(stored.lastReadAt?.toISOString()).toBe(firstMarker);
  });

  it('does not count outbound messages', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511900000003@s.whatsapp.net',
    );
    await createMessage({ tenantId: ownerA.tenantId, conversationId, direction: 'INBOUND' });
    await createMessage({ tenantId: ownerA.tenantId, conversationId, direction: 'OUTBOUND' });
    await createMessage({ tenantId: ownerA.tenantId, conversationId, direction: 'OUTBOUND' });

    expect(await unreadOf(ownerA, conversationId)).toBe(1);
  });

  it('increments the counter when a new inbound message is received', async () => {
    const instanceName = `unread-${randomUUID()}`;
    await prisma.whatsAppInstance.create({
      data: {
        tenantId: ownerA.tenantId,
        name: 'Loja',
        instanceName,
        status: 'CONNECTED',
        active: true,
      },
    });

    await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Primeira'));
    await postWebhook(evolutionPayload(instanceName, randomUUID(), 'Segunda'));

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
      select: { id: true },
    });
    expect(await unreadOf(ownerA, conversation.id)).toBe(2);

    const total = await unreadTotal(ownerA);
    expect(total.json().total).toBe(2);
  });

  it('does not double count duplicated webhook events', async () => {
    const instanceName = `unread-${randomUUID()}`;
    await prisma.whatsAppInstance.create({
      data: {
        tenantId: ownerA.tenantId,
        name: 'Loja',
        instanceName,
        status: 'CONNECTED',
        active: true,
      },
    });

    const messageId = randomUUID();
    const payload = evolutionPayload(instanceName, messageId, 'Repetida');
    await postWebhook(payload);
    const duplicate = await postWebhook(payload);
    expect(duplicate.json().ignored).toBe('duplicate_event');

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
      select: { id: true },
    });
    expect(await unreadOf(ownerA, conversation.id)).toBe(1);
  });

  it('keeps messages received after the read marker as unread', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511900000004@s.whatsapp.net',
    );
    await createMessage({
      tenantId: ownerA.tenantId,
      conversationId,
      direction: 'INBOUND',
      occurredAt: new Date(Date.now() - 60_000),
    });

    await markRead(ownerA, conversationId);

    await createMessage({
      tenantId: ownerA.tenantId,
      conversationId,
      direction: 'INBOUND',
      occurredAt: new Date(),
    });

    expect(await unreadOf(ownerA, conversationId)).toBe(1);
  });

  it('excludes archived conversations from the unread total', async () => {
    const instanceId = await seedInstance(ownerA);
    const inbox = await createConversation(ownerA, instanceId, '5511900000005@s.whatsapp.net');
    await createMessage({ tenantId: ownerA.tenantId, conversationId: inbox, direction: 'INBOUND' });

    const archived = await createConversation(ownerA, instanceId, '5511900000006@s.whatsapp.net', {
      isArchived: true,
    });
    await createMessage({
      tenantId: ownerA.tenantId,
      conversationId: archived,
      direction: 'INBOUND',
    });

    const total = await unreadTotal(ownerA);
    expect(total.json().total).toBe(1);
  });

  it('shares the read state between authorized users of the same tenant', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511900000007@s.whatsapp.net',
    );
    await createMessage({ tenantId: ownerA.tenantId, conversationId, direction: 'INBOUND' });

    const response = await markRead(memberA, conversationId);
    expect(response.statusCode).toBe(200);

    expect(await unreadOf(ownerA, conversationId)).toBe(0);
  });

  it('isolates unread state across tenants', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511900000008@s.whatsapp.net',
    );
    await createMessage({ tenantId: ownerA.tenantId, conversationId, direction: 'INBOUND' });

    const foreignRead = await markRead(ownerB, conversationId);
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().code).toBe('CONVERSATION_NOT_FOUND');

    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(stored.lastReadAt).toBeNull();

    const foreignList = await listConversations(ownerB);
    expect(foreignList.json().data).toHaveLength(0);
    expect((await unreadTotal(ownerB)).json().total).toBe(0);
  });

  it('requires authentication', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${randomUUID()}/read`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('publishes conversation.updated when the read state changes', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511900000009@s.whatsapp.net',
    );
    await createMessage({ tenantId: ownerA.tenantId, conversationId, direction: 'INBOUND' });

    const emit = vi.spyOn(harness.app.get(RealtimeService), 'emitToTenant');
    await markRead(ownerA, conversationId);

    expect(emit).toHaveBeenCalledWith(
      ownerA.tenantId,
      'conversation.updated',
      expect.objectContaining({ conversationId }),
    );
    emit.mockRestore();
  });
});
