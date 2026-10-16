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
  prisma: { webhookEvent: { create: ReturnType<typeof vi.fn> } };
  instances: {
    resolveByInstanceName: ReturnType<typeof vi.fn>;
    applyProviderConnectionState: ReturnType<typeof vi.fn>;
  };
  messages: { updateOutboundStatusByExternalId: ReturnType<typeof vi.fn> };
  realtime: {
    emitToTenant: ReturnType<typeof vi.fn>;
    emitToConversation: ReturnType<typeof vi.fn>;
  };
}

function createHarness(): Harness {
  const prisma = { webhookEvent: { create: vi.fn().mockResolvedValue({}) } };
  const instances = {
    resolveByInstanceName: vi.fn().mockResolvedValue({
      id: 'instance-1',
      tenantId: 'tenant-1',
      instanceName: 'inst-1',
      status: 'CONNECTED',
    }),
    applyProviderConnectionState: vi.fn().mockResolvedValue(null),
  };
  const messages = { updateOutboundStatusByExternalId: vi.fn().mockResolvedValue(null) };
  const realtime = { emitToTenant: vi.fn(), emitToConversation: vi.fn() };

  const service = new WebhookService(
    prisma as unknown as PrismaService,
    instances as unknown as WhatsAppInstancesService,
    {} as unknown as ContactsService,
    {} as unknown as WhatsAppDirectoryService,
    messages as unknown as MessagesService,
    realtime as unknown as RealtimeService,
    { get: vi.fn(() => false) } as unknown as ConfigService<Env, true>,
    { enqueue: vi.fn() } as unknown as JobQueue,
  );

  return { service, prisma, instances, messages, realtime };
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
