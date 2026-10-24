import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import type { ContactsService } from '../../../src/modules/contacts/contacts.service.js';
import type { MessagesService } from '../../../src/modules/conversations/messages.service.js';
import { WebhookService } from '../../../src/modules/webhooks/webhook.service.js';
import type { WhatsAppDirectoryService } from '../../../src/modules/whatsapp/whatsapp-directory.service.js';
import type { WhatsAppInstancesService } from '../../../src/modules/whatsapp/whatsapp-instances.service.js';

interface Harness {
  service: WebhookService;
  prisma: {
    webhookEvent: { create: ReturnType<typeof vi.fn> };
    message: { findFirst: ReturnType<typeof vi.fn> };
    conversation: { update: ReturnType<typeof vi.fn> };
  };
  instances: {
    resolveByInstanceName: ReturnType<typeof vi.fn>;
    applyProviderConnectionState: ReturnType<typeof vi.fn>;
  };
  messages: {
    updateOutboundStatusByExternalId: ReturnType<typeof vi.fn>;
    markFallbackAttempted: ReturnType<typeof vi.fn>;
  };
  realtime: {
    emitToTenant: ReturnType<typeof vi.fn>;
    emitToConversation: ReturnType<typeof vi.fn>;
  };
  queue: { enqueue: ReturnType<typeof vi.fn> };
}

function createHarness(): Harness {
  const prisma = {
    webhookEvent: { create: vi.fn().mockResolvedValue({}) },
    message: { findFirst: vi.fn().mockResolvedValue(null) },
    conversation: { update: vi.fn().mockResolvedValue({}) },
  };
  const instances = {
    resolveByInstanceName: vi.fn().mockResolvedValue({
      id: 'instance-1',
      tenantId: 'tenant-1',
      instanceName: 'inst-1',
      status: 'CONNECTED',
    }),
    applyProviderConnectionState: vi.fn().mockResolvedValue(null),
  };
  const messages = {
    updateOutboundStatusByExternalId: vi.fn().mockResolvedValue(null),
    markFallbackAttempted: vi.fn().mockResolvedValue(undefined),
  };
  const realtime = { emitToTenant: vi.fn(), emitToConversation: vi.fn() };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };

  const service = new WebhookService(
    prisma as unknown as PrismaService,
    instances as unknown as WhatsAppInstancesService,
    {} as unknown as ContactsService,
    {} as unknown as WhatsAppDirectoryService,
    messages as unknown as MessagesService,
    realtime as unknown as RealtimeService,
    { isAutoEnabled: vi.fn().mockResolvedValue(false) } as never,
    { get: vi.fn(() => false) } as unknown as ConfigService<Env, true>,
    queue as unknown as JobQueue,
  );

  return { service, prisma, instances, messages, realtime, queue };
}

describe('WebhookService messages.update', () => {
  it('applies a provider ERROR to the matching outbound message and emits the failure', async () => {
    const { service, messages, realtime } = createHarness();
    messages.updateOutboundStatusByExternalId.mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: 'FAILED',
    });

    const result = await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-1', status: 'ERROR' }],
    });

    expect(result.accepted).toBe(true);
    expect(messages.updateOutboundStatusByExternalId).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: 'FAILED',
    });
    expect(realtime.emitToConversation).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      'message.updated',
      expect.objectContaining({ messageId: 'message-1', status: 'FAILED' }),
    );
  });

  it('does not emit anything when the error belongs to another tenant (no match)', async () => {
    const { service, messages, realtime } = createHarness();
    messages.updateOutboundStatusByExternalId.mockResolvedValue(null);

    await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-foreign', status: 'ERROR' }],
    });

    expect(messages.updateOutboundStatusByExternalId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', externalMessageId: 'ext-foreign' }),
    );
    expect(realtime.emitToConversation).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('falls back a failed outbound message to the alternate address', async () => {
    const { service, prisma, messages, queue } = createHarness();
    messages.updateOutboundStatusByExternalId.mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: 'FAILED',
    });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      metadata: {},
      conversation: {
        id: 'conversation-1',
        externalContactId: '5511999999999@s.whatsapp.net',
        externalLid: '75209205874877@lid',
        preferredAddress: null,
        contact: { phone: null },
      },
    });

    await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-1', status: 'ERROR' }],
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: { preferredAddress: 'PN' },
    });
    expect(messages.markFallbackAttempted).toHaveBeenCalledWith('message-1');
    expect(queue.enqueue).toHaveBeenCalledWith('whatsapp.message.send', {
      tenantId: 'tenant-1',
      messageId: 'message-1',
      fallback: true,
    });
  });

  it('does not fall back again when the message was already attempted', async () => {
    const { service, prisma, messages, queue } = createHarness();
    messages.updateOutboundStatusByExternalId.mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: 'FAILED',
    });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      metadata: { fallbackAttempted: true },
      conversation: {
        id: 'conversation-1',
        externalContactId: '5511999999999@s.whatsapp.net',
        externalLid: '75209205874877@lid',
        preferredAddress: 'PN',
        contact: { phone: null },
      },
    });

    await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-1', status: 'ERROR' }],
    });

    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('is idempotent for a duplicated provider event', async () => {
    const { service, prisma, messages } = createHarness();
    prisma.webhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-1', status: 'ERROR' }],
    });

    expect(result).toEqual({ accepted: true, ignored: 'duplicate_event' });
    expect(messages.updateOutboundStatusByExternalId).not.toHaveBeenCalled();
  });

  it('acknowledges a malformed event instead of failing the webhook', async () => {
    const { service, prisma } = createHarness();
    prisma.webhookEvent.create.mockRejectedValue(new Error('database unavailable'));

    const result = await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-1', status: 'ERROR' }],
    });

    expect(result).toEqual({ accepted: false, ignored: 'processing_error' });
  });
});

describe('WebhookService messages.set', () => {
  it('ignores history batches while automatic history import is disabled', async () => {
    const { service, prisma, instances } = createHarness();

    const result = await service.ingestEvolution({
      event: 'messages.set',
      instance: 'inst-1',
      data: [
        {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'ext-1' },
          message: { conversation: 'histórico' },
          messageTimestamp: 1_700_000_000,
        },
      ],
    });

    expect(result).toEqual({ accepted: true, ignored: 'history_import_disabled' });
    expect(instances.resolveByInstanceName).toHaveBeenCalledWith('inst-1');
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });
});

describe('WebhookService connection.update', () => {
  it('persists the provider state and broadcasts the change', async () => {
    const { service, instances, realtime } = createHarness();
    instances.applyProviderConnectionState.mockResolvedValue({
      instanceId: 'instance-1',
      tenantId: 'tenant-1',
      status: 'DISCONNECTED',
      changed: true,
    });

    const result = await service.ingestEvolution({
      event: 'connection.update',
      instance: 'inst-1',
      data: { instance: 'inst-1', state: 'close', statusReason: 'conflict' },
    });

    expect(result.accepted).toBe(true);
    expect(instances.applyProviderConnectionState).toHaveBeenCalledWith('inst-1', 'close');
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'whatsapp.instance.updated',
      expect.objectContaining({ instanceId: 'instance-1', status: 'DISCONNECTED' }),
    );
  });

  it('does not broadcast when the connection state did not change', async () => {
    const { service, instances, realtime } = createHarness();
    instances.applyProviderConnectionState.mockResolvedValue({
      instanceId: 'instance-1',
      tenantId: 'tenant-1',
      status: 'CONNECTED',
      changed: false,
    });

    await service.ingestEvolution({
      event: 'connection.update',
      instance: 'inst-1',
      data: { instance: 'inst-1', state: 'open' },
    });

    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });
});
