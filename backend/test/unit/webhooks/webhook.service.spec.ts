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
    message: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    conversation: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    conversationParticipant: { findMany: ReturnType<typeof vi.fn> };
    contact: { findMany: ReturnType<typeof vi.fn> };
  };
  instances: {
    resolveByInstanceName: ReturnType<typeof vi.fn>;
    applyConnectionObservation: ReturnType<typeof vi.fn>;
    applyProviderQr: ReturnType<typeof vi.fn>;
    applyHistorySyncUpdate: ReturnType<typeof vi.fn>;
    markHistorySyncInterrupted: ReturnType<typeof vi.fn>;
  };
  messages: {
    updateOutboundStatusByExternalId: ReturnType<typeof vi.fn>;
    markFallbackAttempted: ReturnType<typeof vi.fn>;
  };
  conversationSync: {
    syncChat: ReturnType<typeof vi.fn>;
    syncGroup: ReturnType<typeof vi.fn>;
    syncGroupParticipants: ReturnType<typeof vi.fn>;
  };
  contacts: { syncFromWhatsAppEvent: ReturnType<typeof vi.fn> };
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
    message: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    conversationParticipant: { findMany: vi.fn().mockResolvedValue([]) },
    contact: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const instances = {
    resolveByInstanceName: vi.fn().mockResolvedValue({
      id: 'instance-1',
      tenantId: 'tenant-1',
      instanceName: 'inst-1',
      status: 'CONNECTED',
    }),
    applyConnectionObservation: vi.fn().mockResolvedValue(null),
    applyProviderQr: vi.fn().mockResolvedValue(undefined),
    applyHistorySyncUpdate: vi.fn().mockResolvedValue(null),
    markHistorySyncInterrupted: vi.fn().mockResolvedValue(null),
  };
  const messages = {
    updateOutboundStatusByExternalId: vi.fn().mockResolvedValue(null),
    markFallbackAttempted: vi.fn().mockResolvedValue(undefined),
  };
  const conversationSync = {
    syncChat: vi.fn().mockResolvedValue(false),
    syncGroup: vi.fn().mockResolvedValue(false),
    syncGroupParticipants: vi.fn().mockResolvedValue(false),
  };
  const contacts = {
    syncFromWhatsAppEvent: vi.fn().mockResolvedValue(null),
  };
  const realtime = { emitToTenant: vi.fn(), emitToConversation: vi.fn() };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };

  const service = new WebhookService(
    prisma as unknown as PrismaService,
    instances as unknown as WhatsAppInstancesService,
    contacts as unknown as ContactsService,
    {} as unknown as WhatsAppDirectoryService,
    conversationSync as never,
    messages as unknown as MessagesService,
    realtime as unknown as RealtimeService,
    { isAutoEnabled: vi.fn().mockResolvedValue(false) } as never,
    { get: vi.fn(() => false) } as unknown as ConfigService<Env, true>,
    queue as unknown as JobQueue,
  );

  return { service, prisma, instances, messages, conversationSync, contacts, realtime, queue };
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

describe('WebhookService connection lifecycle', () => {
  it('applies connection.update with a numeric statusReason and the provider timestamp', async () => {
    const { service, instances } = createHarness();
    const observedAt = new Date('2026-10-29T10:00:00Z');

    const result = await service.ingestEvolution(
      {
        event: 'connection.update',
        instance: 'inst-1',
        data: { instance: 'inst-1', state: 'close', statusReason: 401 },
      },
      { observedAt },
    );

    expect(result.accepted).toBe(true);
    expect(instances.applyConnectionObservation).toHaveBeenCalledWith('inst-1', 'close', {
      observedAt,
      reason: 401,
      source: 'webhook',
    });
  });

  it('does not call the state handler when connection.update has no state', async () => {
    const { service, instances } = createHarness();

    await service.ingestEvolution({
      event: 'connection.update',
      instance: 'inst-1',
      data: { instance: 'inst-1' },
    });

    expect(instances.applyConnectionObservation).not.toHaveBeenCalled();
  });

  it('treats status.instance closed as a disconnected session', async () => {
    const { service, instances } = createHarness();
    const disconnectionAt = new Date(Date.now() - 1_000);

    const result = await service.ingestEvolution({
      event: 'status.instance',
      instance: 'inst-1',
      data: {
        instance: 'inst-1',
        status: 'closed',
        disconnectionReasonCode: 401,
        disconnectionAt: disconnectionAt.toISOString(),
      },
    });

    expect(result.accepted).toBe(true);
    expect(instances.applyConnectionObservation).toHaveBeenCalledWith('inst-1', 'close', {
      observedAt: disconnectionAt,
      reason: 401,
      source: 'webhook',
    });
  });

  it('ignores status.instance events that are not closed', async () => {
    const { service, instances } = createHarness();

    await service.ingestEvolution({
      event: 'status.instance',
      instance: 'inst-1',
      data: { instance: 'inst-1', status: 'created' },
    });

    expect(instances.applyConnectionObservation).not.toHaveBeenCalled();
  });

  it('treats logout.instance as a disconnected session', async () => {
    const { service, instances } = createHarness();
    const observedAt = new Date('2026-10-29T10:00:00Z');

    await service.ingestEvolution(
      { event: 'logout.instance', instance: 'inst-1', data: null },
      { observedAt },
    );

    expect(instances.applyConnectionObservation).toHaveBeenCalledWith('inst-1', 'close', {
      observedAt,
      reason: null,
      source: 'webhook',
    });
  });

  it('handles qrcode.updated without persisting the QR payload', async () => {
    const { service, instances, prisma } = createHarness();
    const observedAt = new Date('2026-10-29T10:00:00Z');
    const data = { qrcode: { base64: 'ZmFrZS1xcg==', code: '2@qr', pairingCode: '12345678' } };

    const result = await service.ingestEvolution(
      { event: 'qrcode.updated', instance: 'inst-1', data },
      { observedAt },
    );

    expect(result).toEqual({ accepted: true });
    expect(instances.applyProviderQr).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: 'inst-1', tenantId: 'tenant-1' }),
      data,
      observedAt,
    );
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('accepts uppercase event names for the new lifecycle events', async () => {
    const { service, instances } = createHarness();

    await service.ingestEvolution({
      event: 'STATUS_INSTANCE',
      instance: 'inst-1',
      data: { instance: 'inst-1', status: 'closed' },
    });

    expect(instances.applyConnectionObservation).toHaveBeenCalled();
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
      original.contacts as unknown as ContactsService,
      {} as unknown as WhatsAppDirectoryService,
      original.conversationSync as never,
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
      observedAt: expect.any(Date),
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
      observedAt: expect.any(Date),
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
      messages: 10,
      observedAt: expect.any(Date),
      completed: true,
    });
  });

  it('records the completion even when automatic history import is disabled', async () => {
    const { service, instances } = createHarness();

    const result = await service.ingestEvolution({
      event: 'MESSAGING_HISTORY_SET',
      instance: 'inst-1',
      data: { messageCount: 82744, chatCount: 120, contactCount: 300, progress: 100 },
    });

    expect(result.accepted).toBe(true);
    expect(instances.applyHistorySyncUpdate).toHaveBeenCalledWith('inst-1', {
      progress: 100,
      messages: 82744,
      observedAt: expect.any(Date),
      completed: true,
    });
  });

  it('updates the real progress from the history sync notification', async () => {
    const { service, instances } = createHarness();
    const observedAt = new Date('2026-10-29T13:48:04.000Z');

    await service.ingestEvolution(
      {
        event: 'messages.edited',
        instance: 'inst-1',
        data: {
          type: 'HISTORY_SYNC_NOTIFICATION',
          historySyncNotification: {
            progress: 83,
            chunkOrder: 14,
            syncType: 'RECENT',
          },
        },
      },
      { observedAt },
    );

    expect(instances.applyHistorySyncUpdate).toHaveBeenCalledWith('inst-1', {
      progress: 83,
      chunks: 14,
      observedAt,
      completed: false,
    });
  });

  it('ignores on-demand history notifications when reporting initial sync', async () => {
    const { service, instances } = createHarness();

    await service.ingestEvolution({
      event: 'messages.edited',
      instance: 'inst-1',
      data: {
        type: 'HISTORY_SYNC_NOTIFICATION',
        historySyncNotification: {
          progress: 20,
          chunkOrder: 2,
          syncType: 'ON_DEMAND',
        },
      },
    });

    expect(instances.applyHistorySyncUpdate).not.toHaveBeenCalled();
  });

  it('does not treat non-history messages.edited payloads as sync progress', async () => {
    const { service, instances } = createHarness();

    await service.ingestEvolution({
      event: 'messages.edited',
      instance: 'inst-1',
      data: {
        type: 'NON_BLOCKING_DATA',
        message: { conversation: 'not a history notification' },
      },
    });

    expect(instances.applyHistorySyncUpdate).not.toHaveBeenCalled();
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
      observedAt: expect.any(Date),
      failed: true,
      error: 'history_import_failed',
    });
  });
});

describe('WebhookService presence.update', () => {
  it('broadcasts online presence without creating conversations or messages', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: false,
      contact: { name: 'Ana' },
    });

    const result = await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      date_time: '2026-10-24T12:00:00.000Z',
      data: {
        id: '5511999999999@s.whatsapp.net',
        presences: {
          '5511999999999@s.whatsapp.net': { lastKnownPresence: 'available' },
        },
      },
    });

    expect(result).toEqual({ accepted: true });
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        conversationId: 'conversation-1',
        participantName: 'Ana',
        participantPhone: '5511999999999',
        state: 'online',
        lastSeenAt: null,
        occurredAt: '2026-10-24T12:00:00.000Z',
      }),
    );
  });

  it('includes last seen only when a valid timestamp is provided', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: false,
      contact: { name: 'Ana' },
    });
    const lastSeen = Date.parse('2026-10-24T11:35:00.000Z');

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      date_time: '2026-10-24T12:00:00.000Z',
      data: {
        id: '5511999999999@s.whatsapp.net',
        presences: {
          '5511999999999@s.whatsapp.net': {
            lastKnownPresence: 'unavailable',
            lastSeen,
          },
        },
      },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        state: 'offline',
        lastSeenAt: '2026-10-24T11:35:00.000Z',
      }),
    );
  });

  it('does not invent a last seen timestamp when it is absent or in the future', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: false,
      contact: null,
    });

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      date_time: '2026-10-24T12:00:00.000Z',
      data: {
        id: '5511999999999@s.whatsapp.net',
        presences: {
          '5511999999999@s.whatsapp.net': { lastKnownPresence: 'unavailable' },
        },
      },
    });
    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      date_time: '2026-10-24T12:00:00.000Z',
      data: {
        id: '5511999999999@s.whatsapp.net',
        presences: {
          '5511999999999@s.whatsapp.net': {
            lastKnownPresence: 'unavailable',
            lastSeen: Date.now() + 10 * 60_000,
          },
        },
      },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledTimes(2);
    for (const call of realtime.emitToTenant.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ lastSeenAt: null }));
    }
  });

  it('broadcasts typing and recording activity', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: false,
      contact: null,
    });

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '5511999999999@s.whatsapp.net',
        presences: { '5511999999999@s.whatsapp.net': { lastKnownPresence: 'composing' } },
      },
    });
    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '5511999999999@s.whatsapp.net',
        presences: { '5511999999999@s.whatsapp.net': { lastKnownPresence: 'recording' } },
      },
    });

    expect(realtime.emitToTenant).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({ state: 'composing' }),
    );
    expect(realtime.emitToTenant).toHaveBeenNthCalledWith(
      2,
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({ state: 'recording' }),
    );
  });

  it('resolves the group participant name from the synchronized participant list', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      contact: null,
    });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      {
        jid: '5511888888888@s.whatsapp.net',
        lid: null,
        phone: '5511888888888',
        name: 'Bruno',
      },
    ]);

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '120363000000000000@g.us',
        presences: {
          '5511888888888@s.whatsapp.net': { lastKnownPresence: 'composing' },
        },
      },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        participantName: 'Bruno',
        participantPhone: '5511888888888',
        state: 'composing',
      }),
    );
  });

  it('resolves a group participant whose presence arrives as @lid', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      contact: null,
    });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      {
        jid: '5511888888888@s.whatsapp.net',
        lid: '63604221026389@lid',
        phone: '5511888888888',
        name: 'Ernandes',
      },
    ]);
    prisma.contact.findMany.mockResolvedValue([
      { phone: '5511888888888', name: 'Ernandes Lourenço' },
    ]);

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '120363000000000000@g.us',
        presences: {
          '63604221026389@lid': { lastKnownPresence: 'recording' },
        },
      },
    });

    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', phone: { in: ['5511888888888'] } },
      select: { phone: true, name: true },
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        participantId: '63604221026389@lid',
        participantName: 'Ernandes Lourenço',
        participantPhone: '5511888888888',
        state: 'recording',
      }),
    );
  });

  it('resolves a PN presence for a participant stored by its LID', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      contact: null,
    });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      {
        jid: '63604221026389@lid',
        lid: null,
        phone: '5511888888888',
        name: 'Ernandes Lourenço',
      },
    ]);

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '120363000000000000@g.us',
        presences: {
          '5511888888888@s.whatsapp.net': { lastKnownPresence: 'composing' },
        },
      },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        participantName: 'Ernandes Lourenço',
        participantPhone: '5511888888888',
        state: 'composing',
      }),
    );
  });

  it('falls back to the latest group message sender name for an unsynced @lid', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      contact: null,
    });
    prisma.conversationParticipant.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValue([
      { senderId: '63604221026389@lid', senderName: 'Ernandes Lourenço' },
    ]);

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '120363000000000000@g.us',
        presences: {
          '63604221026389@lid': { lastKnownPresence: 'recording' },
        },
      },
    });

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          conversationId: 'conversation-1',
          senderId: { in: expect.arrayContaining(['63604221026389@lid']) },
        }),
      }),
    );
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        participantName: 'Ernandes Lourenço',
        state: 'recording',
      }),
    );
  });

  it('does not expose unresolved participant identifiers as names', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      contact: null,
    });
    prisma.conversationParticipant.findMany.mockResolvedValue([]);

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '120363000000000000@g.us',
        presences: {
          '63604221026389@lid': { lastKnownPresence: 'composing' },
        },
      },
    });

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        participantId: '63604221026389@lid',
        participantName: null,
        participantPhone: null,
        state: 'composing',
      }),
    );
  });

  it('reuses the participant directory between successive activity events', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      contact: null,
    });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      {
        jid: '63604221026389@lid',
        lid: null,
        phone: '5511888888888',
        name: 'Ernandes Lourenço',
      },
    ]);

    for (const state of ['composing', 'recording'] as const) {
      await service.ingestEvolution({
        event: 'presence.update',
        instance: 'inst-1',
        data: {
          id: '120363000000000000@g.us',
          presences: {
            '63604221026389@lid': { lastKnownPresence: state },
          },
        },
      });
    }

    expect(prisma.conversationParticipant.findMany).toHaveBeenCalledTimes(1);
    expect(realtime.emitToTenant).toHaveBeenCalledTimes(2);
    expect(realtime.emitToTenant).toHaveBeenLastCalledWith(
      'tenant-1',
      'conversation.presence',
      expect.objectContaining({
        participantName: 'Ernandes Lourenço',
        state: 'recording',
      }),
    );
  });

  it('scopes participant resolution to the conversation tenant and instance', async () => {
    const { service, prisma } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      contact: null,
    });

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '120363000000000000@g.us',
        presences: {
          '63604221026389@lid': { lastKnownPresence: 'composing' },
        },
      },
    });

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          whatsappInstanceId: 'instance-1',
        }),
      }),
    );
    expect(prisma.conversationParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', conversationId: 'conversation-1', active: true },
      }),
    );
  });

  it('ignores presence for an unknown conversation and unsupported states', async () => {
    const { service, realtime } = createHarness();

    await service.ingestEvolution({
      event: 'presence.update',
      instance: 'inst-1',
      data: {
        id: '5511999999999@s.whatsapp.net',
        presences: {
          '5511999999999@s.whatsapp.net': { lastKnownPresence: 'available' },
        },
      },
    });

    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });
});

describe('WebhookService contacts and chats synchronization', () => {
  it('normalizes a single contact event object', async () => {
    const { service, contacts } = createHarness();

    await service.ingestEvolution({
      event: 'contacts.upsert',
      instance: 'inst-1',
      data: {
        remoteJid: '5511999999999@s.whatsapp.net',
        pushName: 'Ana',
        profilePicUrl: 'https://pps.whatsapp.net/a.jpg',
      },
    });

    expect(contacts.syncFromWhatsAppEvent).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
      avatarUrl: 'https://pps.whatsapp.net/a.jpg',
    });
  });

  it('processes contact arrays and keeps the event tenant scoped', async () => {
    const { service, contacts } = createHarness();

    await service.ingestEvolution({
      event: 'CONTACTS_UPDATE',
      instance: 'inst-1',
      data: [
        { remoteJid: '5511911111111@s.whatsapp.net', name: 'Alice' },
        { remoteJid: '5511922222222@s.whatsapp.net', verifiedName: 'Empresa' },
        { remoteJid: '120363000000000000@g.us', name: 'Grupo' },
      ],
    });

    expect(contacts.syncFromWhatsAppEvent).toHaveBeenCalledTimes(3);
    expect(contacts.syncFromWhatsAppEvent).toHaveBeenNthCalledWith(1, {
      tenantId: 'tenant-1',
      jid: '5511911111111@s.whatsapp.net',
      name: 'Alice',
      avatarUrl: null,
    });
    expect(contacts.syncFromWhatsAppEvent).toHaveBeenNthCalledWith(3, {
      tenantId: 'tenant-1',
      jid: '120363000000000000@g.us',
      name: 'Grupo',
      avatarUrl: null,
    });
  });

  it('forwards chat metadata updates without creating conversations', async () => {
    const { service, conversationSync, prisma } = createHarness();

    await service.ingestEvolution({
      event: 'CHATS_UPSERT',
      instance: 'inst-1',
      data: [{ remoteJid: '120363000000000000@g.us', name: 'Grupo novo' }],
    });

    expect(conversationSync.syncChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'instance-1', tenantId: 'tenant-1' }),
      { remoteJid: '120363000000000000@g.us', name: 'Grupo novo' },
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('replaces participants on groups.upsert and preserves them on groups.update', async () => {
    const { service, conversationSync } = createHarness();

    await service.ingestEvolution({
      event: 'GROUPS_UPSERT',
      instance: 'inst-1',
      data: [{ id: '120363000000000000@g.us', subject: 'Grupo' }],
    });
    await service.ingestEvolution({
      event: 'GROUP_UPDATE',
      instance: 'inst-1',
      data: [{ id: '120363000000000000@g.us', subject: 'Grupo novo' }],
    });

    expect(conversationSync.syncGroup).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { id: '120363000000000000@g.us', subject: 'Grupo' },
      { replaceParticipants: true },
    );
    expect(conversationSync.syncGroup).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { id: '120363000000000000@g.us', subject: 'Grupo novo' },
      { replaceParticipants: false },
    );
  });

  it('forwards group participant membership events', async () => {
    const { service, conversationSync } = createHarness();

    await service.ingestEvolution({
      event: 'GROUP_PARTICIPANTS_UPDATE',
      instance: 'inst-1',
      data: {
        id: '120363000000000000@g.us',
        action: 'add',
        participants: ['5511999999999@s.whatsapp.net'],
        participantsData: [],
      },
    });

    expect(conversationSync.syncGroupParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'instance-1', tenantId: 'tenant-1' }),
      expect.objectContaining({ id: '120363000000000000@g.us', action: 'add' }),
    );
  });
});
