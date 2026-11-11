import { MessageType } from '@prisma/client';
import { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { FcmClient } from '../../../src/infrastructure/push/fcm.client.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import {
  buildMessagePush,
  MessagePushService,
  type MessagePushInput,
} from '../../../src/modules/push-notifications/message-push.service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

function input(overrides: Partial<MessagePushInput> = {}): MessagePushInput {
  return {
    conversationId: CONVERSATION_ID,
    type: MessageType.TEXT,
    content: 'Olá, tudo bem?',
    senderName: null,
    contactName: 'Maria Silva',
    isGroup: false,
    groupName: null,
    ...overrides,
  };
}

describe('buildMessagePush', () => {
  it('uses the contact name and text, tagged and linked to the conversation', () => {
    expect(buildMessagePush(input())).toEqual({
      title: 'Maria Silva',
      body: 'Olá, tudo bem?',
      tag: CONVERSATION_ID,
      data: {
        conversationId: CONVERSATION_ID,
        path: `/atendimento/conversas?conversation=${CONVERSATION_ID}`,
      },
    });
  });

  it('labels media and keeps captions', () => {
    expect(buildMessagePush(input({ type: MessageType.AUDIO, content: null })).body).toBe(
      '🎤 Áudio',
    );
    expect(buildMessagePush(input({ type: MessageType.IMAGE, content: 'Cardápio' })).body).toBe(
      '📷 Foto: Cardápio',
    );
  });

  it('names the sender and the group for group messages', () => {
    const push = buildMessagePush(
      input({ isGroup: true, groupName: 'Equipe', senderName: 'João', contactName: null }),
    );
    expect(push.title).toBe('João @ Equipe');
  });

  it('truncates long texts and falls back when nothing identifies the sender', () => {
    const push = buildMessagePush(input({ contactName: null, content: 'a'.repeat(300) }));
    expect(push.title).toBe('Nova mensagem');
    expect(push.body).toHaveLength(120);
    expect(push.body.endsWith('…')).toBe(true);
  });
});

describe('MessagePushService', () => {
  function createHarness(options: { configured?: boolean } = {}) {
    const prisma = {
      message: { findFirst: vi.fn() },
      pushDevice: { findMany: vi.fn(), deleteMany: vi.fn() },
    };
    const fcm = {
      isConfigured: vi.fn(() => options.configured ?? true),
      send: vi.fn(),
    };
    const queue = { registerProcessor: vi.fn() };
    const tenantContext = new TenantContextService();
    const service = new MessagePushService(
      queue as unknown as JobQueue,
      prisma as unknown as PrismaService,
      tenantContext,
      fcm as unknown as FcmClient,
    );
    return { service, prisma, fcm, queue, tenantContext };
  }

  function storedMessage(conversation: Record<string, unknown> = {}) {
    return {
      type: MessageType.TEXT,
      content: 'Oi',
      senderName: null,
      conversation: {
        id: CONVERSATION_ID,
        isArchived: false,
        deletedAt: null,
        isGroup: false,
        groupName: null,
        contact: { name: 'Maria' },
        ...conversation,
      },
    };
  }

  it('registers the queue processor', () => {
    const { service, queue } = createHarness();
    service.onModuleInit();
    expect(queue.registerProcessor).toHaveBeenCalledWith(
      'push.message.notify',
      expect.any(Function),
    );
  });

  it('sends to the tenant devices inside the tenant context and drops invalid tokens', async () => {
    const { service, prisma, fcm, tenantContext } = createHarness();
    prisma.message.findFirst.mockResolvedValue(storedMessage());
    prisma.pushDevice.findMany.mockResolvedValue([
      { id: 'device-1', token: 'token-1' },
      { id: 'device-2', token: 'token-2' },
    ]);
    const tenantsSeen: Array<string | undefined> = [];
    fcm.send.mockImplementation(async (token: string) => {
      tenantsSeen.push(tenantContext.getContext()?.tenantId);
      return token === 'token-2' ? 'invalid-token' : 'sent';
    });

    await service.process({ tenantId: TENANT_ID, messageId: MESSAGE_ID });

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESSAGE_ID, tenantId: TENANT_ID, direction: 'INBOUND' },
      }),
    );
    expect(prisma.pushDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT_ID,
          tenantUser: { tenantId: TENANT_ID, active: true, user: { active: true } },
        },
      }),
    );
    expect(fcm.send).toHaveBeenCalledTimes(2);
    expect(fcm.send).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ title: 'Maria', body: 'Oi' }),
    );
    expect(tenantsSeen).toEqual([TENANT_ID, TENANT_ID]);
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['device-2'] }, tenantId: TENANT_ID },
    });
  });

  it('does nothing when push is not configured', async () => {
    const { service, prisma } = createHarness({ configured: false });

    await service.process({ tenantId: TENANT_ID, messageId: MESSAGE_ID });

    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('skips archived conversations and missing messages', async () => {
    const { service, prisma, fcm } = createHarness();
    prisma.message.findFirst.mockResolvedValueOnce(storedMessage({ isArchived: true }));
    prisma.message.findFirst.mockResolvedValueOnce(null);

    await service.process({ tenantId: TENANT_ID, messageId: MESSAGE_ID });
    await service.process({ tenantId: TENANT_ID, messageId: MESSAGE_ID });

    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
    expect(fcm.send).not.toHaveBeenCalled();
  });

  it('ignores malformed jobs', async () => {
    const { service, prisma } = createHarness();

    await service.process({ tenantId: TENANT_ID });

    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });
});
