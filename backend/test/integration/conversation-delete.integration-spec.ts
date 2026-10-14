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
  isArchived: boolean;
  isPinned: boolean;
  unreadCount: number;
  status: string;
}

describe('Conversation deletion (integration)', () => {
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
    ownerA = await seedTenant(harness.app, prisma, { name: 'Delete Owner A', role: 'OWNER' });
    memberA = await seedMember(harness.app, prisma, ownerA.tenantId, {
      name: 'Delete Member A',
      role: 'USER',
    });
    ownerB = await seedTenant(harness.app, prisma, { name: 'Delete Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, memberA, ownerB]);
  });

  async function seedInstance(tenant: SeededTenant): Promise<string> {
    const instance = await prisma.whatsAppInstance.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Loja',
        instanceName: `delete-${randomUUID()}`,
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
    options: { isArchived?: boolean; isPinned?: boolean } = {},
  ): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.tenantId,
        whatsappInstanceId: instanceId,
        externalContactId: jid,
        isGroup: false,
        status: 'OPEN',
        isArchived: options.isArchived ?? false,
        isPinned: options.isPinned ?? false,
      },
      select: { id: true },
    });
    return conversation.id;
  }

  async function createInboundMessage(tenantId: string, conversationId: string): Promise<void> {
    await prisma.message.create({
      data: {
        tenantId,
        conversationId,
        direction: 'INBOUND',
        type: 'TEXT',
        content: 'oi',
        status: 'RECEIVED',
      },
    });
  }

  function listConversations(tenant: SeededTenant, query = '') {
    return harness.app.inject({
      method: 'GET',
      url: `/api/conversations${query}`,
      headers: authHeaders(tenant),
    });
  }

  function getConversation(tenant: SeededTenant, conversationId: string) {
    return harness.app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}`,
      headers: authHeaders(tenant),
    });
  }

  function remove(tenant: SeededTenant, conversationId: string) {
    return harness.app.inject({
      method: 'DELETE',
      url: `/api/conversations/${conversationId}`,
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

  function postWebhook(payload: object) {
    const token = process.env.EVOLUTION_WEBHOOK_SECRET ?? 'test-webhook-secret';
    return harness.app.inject({
      method: 'POST',
      url: `/api/webhooks/evolution?token=${token}`,
      payload,
    });
  }

  it('removes a non-archived conversation from the inbox and preserves its history', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000001@s.whatsapp.net',
    );
    await createInboundMessage(ownerA.tenantId, conversationId);

    const response = await remove(ownerA, conversationId);
    expect(response.statusCode).toBe(204);

    const inbox = await listConversations(ownerA);
    expect((inbox.json().data as ConversationListItem[]).map((item) => item.id)).not.toContain(
      conversationId,
    );

    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(stored.deletedAt).not.toBeNull();
    const messageCount = await prisma.message.count({ where: { conversationId } });
    expect(messageCount).toBe(1);
  });

  it('removes an archived conversation from the archived listing', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000002@s.whatsapp.net',
      { isArchived: true },
    );

    const response = await remove(ownerA, conversationId);
    expect(response.statusCode).toBe(204);

    const archived = await listConversations(ownerA, '?archived=true');
    expect((archived.json().data as ConversationListItem[]).map((item) => item.id)).not.toContain(
      conversationId,
    );
  });

  it('hides the conversation from the detail endpoint', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000003@s.whatsapp.net',
    );

    await remove(ownerA, conversationId);

    const detail = await getConversation(ownerA, conversationId);
    expect(detail.statusCode).toBe(404);
    expect(detail.json().code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('stays hidden across subsequent reloads', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000004@s.whatsapp.net',
    );

    await remove(ownerA, conversationId);

    const first = await listConversations(ownerA);
    const second = await listConversations(ownerA);
    expect((first.json().data as ConversationListItem[]).map((item) => item.id)).not.toContain(
      conversationId,
    );
    expect((second.json().data as ConversationListItem[]).map((item) => item.id)).not.toContain(
      conversationId,
    );
  });

  it('excludes deleted conversations from the unread total', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000005@s.whatsapp.net',
    );
    await createInboundMessage(ownerA.tenantId, conversationId);

    expect((await unreadTotal(ownerA)).json().total).toBe(1);

    await remove(ownerA, conversationId);
    expect((await unreadTotal(ownerA)).json().total).toBe(0);
  });

  it('does not revive a deleted conversation when a new inbound message arrives', async () => {
    const instanceName = `delete-${randomUUID()}`;
    const instance = await prisma.whatsAppInstance.create({
      data: {
        tenantId: ownerA.tenantId,
        name: 'Loja',
        instanceName,
        status: 'CONNECTED',
        active: true,
      },
      select: { id: true },
    });
    const conversationId = await createConversation(
      ownerA,
      instance.id,
      '5511910000006@s.whatsapp.net',
    );

    await remove(ownerA, conversationId);

    await postWebhook({
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: { remoteJid: '5511910000006@s.whatsapp.net', fromMe: false, id: randomUUID() },
        pushName: 'Contato Teste',
        message: { conversation: 'Olá de novo' },
      },
    });

    const inbox = await listConversations(ownerA);
    expect((inbox.json().data as ConversationListItem[]).map((item) => item.id)).not.toContain(
      conversationId,
    );
    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(stored.deletedAt).not.toBeNull();
  });

  it('isolates deletion across tenants', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000007@s.whatsapp.net',
    );

    const foreign = await remove(ownerB, conversationId);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe('CONVERSATION_NOT_FOUND');

    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(stored.deletedAt).toBeNull();

    const inbox = await listConversations(ownerA);
    expect((inbox.json().data as ConversationListItem[]).map((item) => item.id)).toContain(
      conversationId,
    );
  });

  it('allows an authorized member to delete a conversation of the tenant', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000008@s.whatsapp.net',
    );

    const response = await remove(memberA, conversationId);
    expect(response.statusCode).toBe(204);
  });

  it('publishes conversation.deleted to the tenant room', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000009@s.whatsapp.net',
    );

    const emit = vi.spyOn(harness.app.get(RealtimeService), 'emitToTenant');
    await remove(ownerA, conversationId);

    expect(emit).toHaveBeenCalledWith(ownerA.tenantId, 'conversation.deleted', {
      conversationId,
    });
    emit.mockRestore();
  });

  it('requires authentication', async () => {
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/conversations/${randomUUID()}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('keeps pin, archive, read, close and reopen working on a live conversation', async () => {
    const instanceId = await seedInstance(ownerA);
    const conversationId = await createConversation(
      ownerA,
      instanceId,
      '5511910000010@s.whatsapp.net',
    );
    await createInboundMessage(ownerA.tenantId, conversationId);

    const pin = await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/pin`,
      headers: authHeaders(ownerA),
    });
    expect(pin.statusCode).toBe(200);
    expect(pin.json().isPinned).toBe(true);

    const archive = await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/archive`,
      headers: authHeaders(ownerA),
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().isArchived).toBe(true);

    const archivedList = await listConversations(ownerA, '?archived=true');
    expect((archivedList.json().data as ConversationListItem[]).map((item) => item.id)).toContain(
      conversationId,
    );

    const unarchive = await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/unarchive`,
      headers: authHeaders(ownerA),
    });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json().isArchived).toBe(false);

    const read = await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/read`,
      headers: authHeaders(ownerA),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().unreadCount).toBe(0);

    const close = await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/close`,
      headers: authHeaders(ownerA),
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('CLOSED');

    const reopen = await harness.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/takeover`,
      headers: authHeaders(ownerA),
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().status).toBe('OPEN');
  });
});
