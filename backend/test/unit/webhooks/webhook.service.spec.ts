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
    webhookEvent: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    message: { findFirst: ReturnType<typeof vi.fn> };
    conversation: { update: ReturnType<typeof vi.fn> };
  };
  instances: {
    resolveByInstanceName: ReturnType<typeof vi.fn>;
    applyProviderConnectionState: ReturnType<typeof vi.fn>;
    applyHistorySyncUpdate: ReturnType<typeof vi.fn>;
    markHistorySyncInterrupted: ReturnType<typeof vi.fn>;
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
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
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
    applyHistorySyncUpdate: vi.fn().mockResolvedValue(null),
    markHistorySyncInterrupted: vi.fn().mockResolvedValue(null),
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
      whatsappInstanceId: 'instance-1',
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
      expect.objectContaining({
        tenantId: 'tenant-1',
        whatsappInstanceId: 'instance-1',
        externalMessageId: 'ext-foreign',
      }),
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
    prisma.webhookEvent.findFirst.mockResolvedValue({
      id: 'event-1',
      processedAt: new Date(),
    });

    const result = await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-1', status: 'ERROR' }],
    });

    expect(result).toEqual({ accepted: true, ignored: 'duplicate_event' });
    expect(messages.updateOutboundStatusByExternalId).not.toHaveBeenCalled();
  });

  it('fails with a retryable status when the event cannot be claimed', async () => {
    const { service, prisma } = createHarness();
    prisma.webhookEvent.create.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.ingestEvolution({
        event: 'messages.update',
        instance: 'inst-1',
        data: [{ keyId: 'ext-1', status: 'ERROR' }],
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_PROCESSING_FAILED', statusCode: 503 });
  });

  it('reprocesses a previously claimed event that was not marked as processed', async () => {
    const { service, prisma, messages } = createHarness();
    prisma.webhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.webhookEvent.findFirst.mockResolvedValue({
      id: 'event-1',
      processedAt: null,
    });
    messages.updateOutboundStatusByExternalId.mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: 'READ',
    });

    const result = await service.ingestEvolution({
      event: 'messages.update',
      instance: 'inst-1',
      data: [{ keyId: 'ext-1', status: 'READ' }],
    });

    expect(result.accepted).toBe(true);
    expect(messages.updateOutboundStatusByExternalId).toHaveBeenCalled();
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'event-1', processedAt: null },
      data: { processedAt: expect.any(Date) },
    });
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

describe('WebhookService history synchronization state', () => {
  function enableHistory(config: Record<string, unknown> = {}): void {
    config.WHATSAPP_HISTORY_IMPORT_ENABLED = true;
  }

  function createHistoryHarness(): Harness & {
    config: Record<string, unknown>;
  } {
    const original = createHarness();
    const config: Record<string, unknown> = { WHATSAPP_HISTORY_IMPORT_ENABLED: true };
    // Rebuild only to inject a config that enables history import.
    const service = new WebhookService(
      original.prisma as unknown as PrismaService,
      original.instances as unknown as WhatsAppInstancesService,
      {} as unknown as ContactsService,
      {} as unknown as WhatsAppDirectoryService,
      original.messages as unknown as MessagesService,
      original.realtime as unknown as RealtimeService,
      { isAutoEnabled: vi.fn().mockResolvedValue(false) } as never,
      {
        get: vi.fn((key: string) => config[key]),
      } as unknown as ConfigService<Env, true>,
      original.queue as unknown as JobQueue,
    );
    enableHistory(config);
    return { ...original, service, config };
  }

  it('exposes provider progress without treating isLatest as completion', async () => {
    const { service, instances } = createHistoryHarness();
    vi.spyOn(service, 'ingestHistoryMessages').mockResolvedValue({
      received: 1,
      imported: 1,
      skipped: 0,
      failed: 0,
      conversations: 1,
    });
    instances.applyHistorySyncUpdate.mockResolvedValue({
      instanceId: 'instance-1',
      tenantId: 'tenant-1',
      status: 'SYNCING',
      progress: 42,
      startedAt: new Date(),
      completedAt: null,
      error: null,
      changed: true,
    });

    await service.ingestEvolution({
      event: 'MESSAGES_SET',
      instance: 'inst-1',
      isLatest: true,
      progress: 42,
      data: [],
    });

    expect(instances.applyHistorySyncUpdate).toHaveBeenCalledWith('inst-1', {
      progress: 42,
      completed: false,
      failed: false,
      error: null,
    });
  });

  it('marks completion only when the provider reports progress 100', async () => {
    const { service, instances } = createHistoryHarness();
    vi.spyOn(service, 'ingestHistoryMessages').mockResolvedValue({
      received: 1,
      imported: 1,
      skipped: 0,
      failed: 0,
      conversations: 1,
    });
    instances.applyHistorySyncUpdate.mockResolvedValue({
      instanceId: 'instance-1',
      tenantId: 'tenant-1',
      status: 'COMPLETED',
      progress: 100,
      startedAt: new Date(),
      completedAt: new Date(),
      error: null,
      changed: true,
    });

    await service.ingestEvolution({
      event: 'messages.set',
      instance: 'inst-1',
      isLatest: false,
      progress: 100,
      data: [],
    });

    expect(instances.applyHistorySyncUpdate).toHaveBeenCalledWith('inst-1', {
      progress: 100,
      completed: true,
      failed: false,
      error: null,
    });
  });

  it('accepts the explicit messaging-history.set completion event', async () => {
    const { service, instances } = createHistoryHarness();
    instances.applyHistorySyncUpdate.mockResolvedValue({
      instanceId: 'instance-1',
      tenantId: 'tenant-1',
      status: 'COMPLETED',
      progress: 100,
      startedAt: new Date(),
      completedAt: new Date(),
      error: null,
      changed: true,
    });

    await service.ingestEvolution({
      event: 'MESSAGING_HISTORY_SET',
      instance: 'inst-1',
      data: { messageCount: 10, chatCount: 2, contactCount: 1, progress: 100 },
    });

    expect(instances.applyHistorySyncUpdate).toHaveBeenCalledWith('inst-1', {
      progress: 100,
      completed: true,
    });
  });

  it('marks a batch with failed messages as failed and asks Evolution to retry', async () => {
    const { service, instances } = createHistoryHarness();
    vi.spyOn(service, 'ingestHistoryMessages').mockRejectedValue(
      new (class extends Error {
        readonly result = { received: 2, imported: 1, skipped: 0, failed: 1, conversations: 1 };
      })(),
    );
    instances.applyHistorySyncUpdate.mockResolvedValue({
      instanceId: 'instance-1',
      tenantId: 'tenant-1',
      status: 'FAILED',
      progress: 30,
      startedAt: new Date(),
      completedAt: null,
      error: 'history_import_failed',
      changed: true,
    });

    await expect(
      service.ingestEvolution({
        event: 'messages.set',
        instance: 'inst-1',
        progress: 30,
        data: [],
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_PROCESSING_FAILED' });

    expect(instances.applyHistorySyncUpdate).toHaveBeenCalledWith('inst-1', {
      progress: 30,
      failed: true,
      error: 'history_import_failed',
    });
  });
});
