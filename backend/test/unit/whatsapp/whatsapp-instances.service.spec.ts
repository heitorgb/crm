import type { ConfigService } from '@nestjs/config';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { EncryptionService } from '../../../src/infrastructure/crypto/encryption.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import {
  EvolutionRequestError,
  type EvolutionClient,
} from '../../../src/modules/whatsapp/evolution/evolution.client.js';
import type { WhatsAppContactSyncService } from '../../../src/modules/whatsapp/whatsapp-contact-sync.service.js';
import { WhatsAppInstanceLimitReachedError } from '../../../src/modules/whatsapp/whatsapp.errors.js';
import { WhatsAppInstancesService } from '../../../src/modules/whatsapp/whatsapp-instances.service.js';

interface EvolutionMock {
  configured: boolean;
  setWebhook: ReturnType<typeof vi.fn>;
  createInstance: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  deleteInstance: ReturnType<typeof vi.fn>;
  instanceExists: ReturnType<typeof vi.fn>;
  getConnectionState: ReturnType<typeof vi.fn>;
}

interface Harness {
  service: WhatsAppInstancesService;
  prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    tenant: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    whatsAppInstance: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  evolution: EvolutionMock;
}

function createHarness(
  env: Record<string, string | undefined>,
  evolutionConfigured = true,
): Harness {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    tenant: {
      findUnique: vi.fn(),
    },
    whatsAppInstance: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
    },
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (client: typeof prisma) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
  const evolution: EvolutionMock = {
    configured: evolutionConfigured,
    setWebhook: vi.fn().mockResolvedValue({}),
    createInstance: vi.fn().mockResolvedValue({
      qrcode: { base64: 'ZmFrZS1xcg==', code: '2@fake' },
      pairingCode: '12345678',
    }),
    connect: vi.fn().mockResolvedValue({ qrcode: { base64: 'ZXhpc3Rpbmc=' }, code: '2@existing' }),
    disconnect: vi.fn().mockResolvedValue({}),
    deleteInstance: vi.fn().mockResolvedValue({}),
    instanceExists: vi.fn().mockResolvedValue(false),
    getConnectionState: vi.fn().mockResolvedValue({ instance: 'inst-1', state: 'close' }),
  };
  const config = {
    get: vi.fn((key: string) => env[key]),
    getOrThrow: vi.fn((key: string) => env[key]),
  };

  const contactSync = { enqueue: vi.fn().mockResolvedValue(undefined) };

  const tenantContext = {
    requireContext: vi.fn(() => ({ tenantId: 't1' })),
  };

  const service = new WhatsAppInstancesService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    { available: false } as unknown as EncryptionService,
    evolution as unknown as EvolutionClient,
    contactSync as unknown as WhatsAppContactSyncService,
    config as unknown as ConfigService<Env, true>,
  );

  return { service, prisma, evolution };
}

function reconcile(service: WhatsAppInstancesService): Promise<void> {
  return (service as unknown as { reconcileWebhooks: () => Promise<void> }).reconcileWebhooks();
}

describe('WhatsAppInstancesService webhook reconciliation', () => {
  it('re-applies the webhook to connected instances with the current PUBLIC_API_URL', async () => {
    const { service, prisma, evolution } = createHarness({
      PUBLIC_API_URL: 'https://crm.example',
      EVOLUTION_WEBHOOK_SECRET: 'secret',
      API_PREFIX: 'api',
    });
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i1', tenantId: 't1', instanceName: 'inst-1', credentialsEncrypted: null },
    ]);

    await reconcile(service);

    expect(prisma.whatsAppInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
    );
    expect(evolution.setWebhook).toHaveBeenCalledWith(
      'inst-1',
      'https://crm.example/api/webhooks/evolution?token=secret',
      [
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
      ],
    );
  });

  it('subscribes to MESSAGES_SET when history import is explicitly enabled', async () => {
    const { service, prisma, evolution } = createHarness({
      PUBLIC_API_URL: 'https://crm.example',
      EVOLUTION_WEBHOOK_SECRET: 'secret',
      API_PREFIX: 'api',
      WHATSAPP_HISTORY_IMPORT_ENABLED: 'true',
    });
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i1', tenantId: 't1', instanceName: 'inst-1', credentialsEncrypted: null },
    ]);

    await reconcile(service);

    expect(evolution.setWebhook).toHaveBeenCalledWith(
      'inst-1',
      'https://crm.example/api/webhooks/evolution?token=secret',
      [
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
      ],
    );
  });

  it('skips reconciliation when Evolution is not configured', async () => {
    const { service, prisma, evolution } = createHarness(
      { PUBLIC_API_URL: 'https://crm.example' },
      false,
    );

    await reconcile(service);

    expect(prisma.whatsAppInstance.findMany).not.toHaveBeenCalled();
    expect(evolution.setWebhook).not.toHaveBeenCalled();
  });

  it('skips reconciliation when PUBLIC_API_URL is missing', async () => {
    const { service, prisma, evolution } = createHarness({});

    await reconcile(service);

    expect(prisma.whatsAppInstance.findMany).not.toHaveBeenCalled();
    expect(evolution.setWebhook).not.toHaveBeenCalled();
  });

  it('keeps going when one instance fails', async () => {
    const { service, prisma, evolution } = createHarness({
      PUBLIC_API_URL: 'https://crm.example',
      EVOLUTION_WEBHOOK_SECRET: 'secret',
      API_PREFIX: 'api',
    });
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i1', tenantId: 't1', instanceName: 'inst-1', credentialsEncrypted: null },
      { id: 'i2', tenantId: 't1', instanceName: 'inst-2', credentialsEncrypted: null },
    ]);
    evolution.setWebhook
      .mockRejectedValueOnce(new Error('evolution down'))
      .mockResolvedValueOnce({});

    await expect(reconcile(service)).resolves.toBeUndefined();

    expect(evolution.setWebhook).toHaveBeenCalledTimes(2);
  });
});

describe('WhatsAppInstancesService.applyProviderConnectionState', () => {
  it('persists the provider state and reports the change', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      status: 'CONNECTED',
    });

    const result = await service.applyProviderConnectionState('inst-1', 'close');

    expect(prisma.whatsAppInstance.findUnique).toHaveBeenCalledWith({
      where: { instanceName: 'inst-1' },
      select: { id: true, tenantId: true, status: true },
    });
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'DISCONNECTED' },
    });
    expect(result).toEqual({
      instanceId: 'i1',
      tenantId: 't1',
      status: 'DISCONNECTED',
      changed: true,
    });
  });

  it('does not write (nor signal a change) when the state is unchanged', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      status: 'CONNECTED',
    });

    const result = await service.applyProviderConnectionState('inst-1', 'open');

    expect(prisma.whatsAppInstance.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'CONNECTED', changed: false });
  });

  it('does not revive an explicitly disconnected instance from a stale connecting state', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      status: 'DISCONNECTED',
    });

    const result = await service.applyProviderConnectionState('inst-1', 'connecting');

    expect(prisma.whatsAppInstance.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'DISCONNECTED', changed: false });
  });

  it('ignores a missing state or unknown instance', async () => {
    const { service, prisma } = createHarness({});

    expect(await service.applyProviderConnectionState('inst-1', null)).toBeNull();
    expect(prisma.whatsAppInstance.findUnique).not.toHaveBeenCalled();

    prisma.whatsAppInstance.findUnique.mockResolvedValue(null);
    expect(await service.applyProviderConnectionState('missing', 'close')).toBeNull();
  });
});

describe('WhatsAppInstancesService.create limit', () => {
  it('creates an instance when there is an available slot', async () => {
    const { service, prisma } = createHarness({});
    prisma.$queryRaw.mockResolvedValue([{ whatsappInstanceLimit: 3 }]);
    prisma.whatsAppInstance.count.mockResolvedValue(2);
    prisma.whatsAppInstance.create.mockResolvedValue({
      id: 'i1',
      name: 'Atendimento',
      instanceName: 'inst-1',
      externalInstanceId: null,
      phone: null,
      status: 'DISCONNECTED',
      active: true,
      credentialsEncrypted: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create({ name: 'Atendimento', instanceName: 'inst-1' });

    expect(result.id).toBe('i1');
    expect(prisma.whatsAppInstance.count).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
    expect(prisma.whatsAppInstance.create).toHaveBeenCalledTimes(1);
  });

  it('rejects creation when the limit has been reached', async () => {
    const { service, prisma } = createHarness({});
    prisma.$queryRaw.mockResolvedValue([{ whatsappInstanceLimit: 3 }]);
    prisma.whatsAppInstance.count.mockResolvedValue(3);

    await expect(
      service.create({ name: 'Atendimento', instanceName: 'inst-4' }),
    ).rejects.toBeInstanceOf(WhatsAppInstanceLimitReachedError);
    expect(prisma.whatsAppInstance.create).not.toHaveBeenCalled();
  });

  it('rejects creation when the organization limit is zero', async () => {
    const { service, prisma } = createHarness({});
    prisma.$queryRaw.mockResolvedValue([{ whatsappInstanceLimit: 0 }]);
    prisma.whatsAppInstance.count.mockResolvedValue(0);

    await expect(
      service.create({ name: 'Atendimento', instanceName: 'inst-1' }),
    ).rejects.toBeInstanceOf(WhatsAppInstanceLimitReachedError);
    expect(prisma.whatsAppInstance.create).not.toHaveBeenCalled();
  });
});


describe('WhatsAppInstancesService connect/disconnect', () => {
  const instanceRow = {
    id: 'i1',
    tenantId: 't1',
    instanceName: 'inst-1',
    status: 'DISCONNECTED',
    active: true,
    credentialsEncrypted: null,
  };

  it('creates the instance when it does not exist yet', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);

    const result = await service.connect('i1');

    expect(evolution.instanceExists).toHaveBeenCalledWith('inst-1');
    expect(evolution.createInstance).toHaveBeenCalledWith('inst-1');
    expect(evolution.deleteInstance).not.toHaveBeenCalled();
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'CONNECTING' },
    });
    expect(result).toMatchObject({
      status: 'CONNECTING',
      pairingCode: '12345678',
      code: '2@fake',
    });
  });

  it('falls back to connect when a concurrent create wins the race', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.createInstance.mockRejectedValue(new EvolutionRequestError('already exists', 409));

    const result = await service.connect('i1');

    expect(evolution.instanceExists).toHaveBeenCalledWith('inst-1');
    expect(evolution.connect).toHaveBeenCalledWith('inst-1');
    expect(evolution.deleteInstance).not.toHaveBeenCalled();
    expect(result.status).toBe('CONNECTING');
  });

  it('reuses an existing instance and returns its current connection ticket', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.instanceExists.mockResolvedValue(true);

    const result = await service.connect('i1');

    expect(evolution.createInstance).not.toHaveBeenCalled();
    expect(evolution.deleteInstance).not.toHaveBeenCalled();
    expect(evolution.connect).toHaveBeenCalledWith('inst-1');
    expect(result).toMatchObject({ status: 'CONNECTING', code: '2@existing' });
  });

  it('does not recreate an instance that is already open', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.instanceExists.mockResolvedValue(true);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });

    const result = await service.connect('i1');

    expect(evolution.connect).not.toHaveBeenCalled();
    expect(evolution.createInstance).not.toHaveBeenCalled();
    expect(evolution.deleteInstance).not.toHaveBeenCalled();
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'CONNECTED' },
    });
    expect(result.status).toBe('CONNECTED');
  });

  it('recreates an existing instance only when it returns no usable ticket', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.instanceExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    evolution.connect.mockResolvedValue({ error: true, message: 'instance does not exist' });

    const result = await service.connect('i1');

    expect(evolution.deleteInstance).toHaveBeenCalledWith('inst-1');
    expect(evolution.createInstance).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('CONNECTING');
  });

  it('rejects a provider response without a connection ticket', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.createInstance.mockResolvedValue({ error: true, message: 'instance does not exist' });

    await expect(service.connect('i1')).rejects.toBeInstanceOf(EvolutionRequestError);
    expect(prisma.whatsAppInstance.update).not.toHaveBeenCalled();
  });

  it('marks the instance disconnected only after the provider confirms close', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue({
      ...instanceRow,
      status: 'CONNECTED',
    });
    prisma.whatsAppInstance.update.mockResolvedValue({ status: 'DISCONNECTED' });

    await expect(service.disconnect('i1')).resolves.toEqual({ status: 'DISCONNECTED' });

    expect(evolution.disconnect).toHaveBeenCalledWith('inst-1');
    expect(evolution.getConnectionState).toHaveBeenCalledWith('inst-1');
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'DISCONNECTED' },
    });
  });

  it('does not mark the instance disconnected when the provider still reports connecting', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue({
      ...instanceRow,
      status: 'CONNECTED',
    });
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'connecting' });
    evolution.instanceExists.mockResolvedValue(true);

    await expect(service.disconnect('i1')).rejects.toBeInstanceOf(EvolutionRequestError);
    expect(prisma.whatsAppInstance.update).not.toHaveBeenCalled();
  });

  it('marks the instance disconnected when the logout response fails but the provider state is close', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue({
      ...instanceRow,
      status: 'CONNECTED',
    });
    prisma.whatsAppInstance.update.mockResolvedValue({ status: 'DISCONNECTED' });
    evolution.disconnect.mockRejectedValue(new EvolutionRequestError('timeout'));

    await expect(service.disconnect('i1')).resolves.toEqual({ status: 'DISCONNECTED' });
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'DISCONNECTED' },
    });
  });

  it('removes the instance from Evolution before deleting it locally', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);

    await service.remove('i1');

    expect(evolution.deleteInstance).toHaveBeenCalledWith('inst-1');
    expect(prisma.whatsAppInstance.deleteMany).toHaveBeenCalledWith({
      where: { id: 'i1', tenantId: 't1' },
    });
  });

  it('keeps the local instance when Evolution cleanup fails', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.deleteInstance.mockRejectedValue(new Error('evolution down'));

    await expect(service.remove('i1')).rejects.toThrow('evolution down');
    expect(prisma.whatsAppInstance.deleteMany).not.toHaveBeenCalled();
  });
});

describe('WhatsAppInstancesService.getQuota', () => {
  it('returns the limit, usage and remaining slots', async () => {
    const { service, prisma } = createHarness({});
    prisma.tenant.findUnique.mockResolvedValue({ whatsappInstanceLimit: 5 });
    prisma.whatsAppInstance.count.mockResolvedValue(2);

    await expect(service.getQuota()).resolves.toEqual({ used: 2, canCreate: true });
  });

  it('reports that creation is blocked when usage is above the limit', async () => {
    const { service, prisma } = createHarness({});
    prisma.tenant.findUnique.mockResolvedValue({ whatsappInstanceLimit: 1 });
    prisma.whatsAppInstance.count.mockResolvedValue(3);

    await expect(service.getQuota()).resolves.toEqual({ used: 3, canCreate: false });
  });
});

describe('WhatsAppInstancesService history sync state', () => {
  it('starts at the first batch and keeps isLatest out of the completion decision', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'IDLE',
      historySyncProgress: null,
      historySyncStartedAt: null,
      historySyncCompletedAt: null,
      historySyncError: null,
    });

    const result = await service.applyHistorySyncUpdate('inst-1', {
      progress: 25,
    });

    expect(result).toMatchObject({
      status: 'SYNCING',
      progress: 25,
      completedAt: null,
      changed: true,
    });
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({
        historySyncStatus: 'SYNCING',
        historySyncProgress: 25,
      }),
    });
  });

  it('does not regress progress while a synchronization is in progress', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'SYNCING',
      historySyncProgress: 70,
      historySyncStartedAt: new Date('2026-10-24T10:00:00Z'),
      historySyncCompletedAt: null,
      historySyncError: null,
    });

    const result = await service.applyHistorySyncUpdate('inst-1', { progress: 40 });

    expect(result).toMatchObject({ status: 'SYNCING', progress: 70, changed: false });
    expect(prisma.whatsAppInstance.update).not.toHaveBeenCalled();
  });

  it('marks completion only on an explicit completion signal', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'SYNCING',
      historySyncProgress: 90,
      historySyncStartedAt: new Date('2026-10-24T10:00:00Z'),
      historySyncCompletedAt: null,
      historySyncError: null,
    });

    const result = await service.applyHistorySyncUpdate('inst-1', {
      progress: 100,
      completed: true,
    });

    expect(result).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
      error: null,
      changed: true,
    });
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({
        historySyncStatus: 'COMPLETED',
        historySyncProgress: 100,
      }),
    });
  });

  it('opens a new cycle when a completed instance starts syncing again', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'COMPLETED',
      historySyncProgress: 100,
      historySyncStartedAt: new Date('2026-10-24T10:00:00Z'),
      historySyncCompletedAt: new Date('2026-10-24T10:05:00Z'),
      historySyncError: null,
    });

    const result = await service.applyHistorySyncUpdate('inst-1', { progress: 5 });

    expect(result).toMatchObject({
      status: 'SYNCING',
      progress: 5,
      completedAt: null,
      changed: true,
    });
  });

  it('records a failed batch and allows a later retry to recover', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValueOnce({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'SYNCING',
      historySyncProgress: 30,
      historySyncStartedAt: new Date('2026-10-24T10:00:00Z'),
      historySyncCompletedAt: null,
      historySyncError: null,
    });

    const failed = await service.applyHistorySyncUpdate('inst-1', {
      progress: 30,
      failed: true,
      error: 'history_import_failed',
    });
    expect(failed).toMatchObject({ status: 'FAILED', error: 'history_import_failed' });

    prisma.whatsAppInstance.findUnique.mockResolvedValueOnce({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'FAILED',
      historySyncProgress: 30,
      historySyncStartedAt: new Date('2026-10-24T10:00:00Z'),
      historySyncCompletedAt: null,
      historySyncError: 'history_import_failed',
    });
    const retry = await service.applyHistorySyncUpdate('inst-1', { progress: 30 });
    expect(retry).toMatchObject({ status: 'SYNCING', error: null });
  });
});

describe('WhatsAppInstancesService stale connection events', () => {
  it('does not revive a disconnected instance when a late open event arrives', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      status: 'DISCONNECTED',
    });

    const result = await service.applyProviderConnectionState('inst-1', 'open');

    expect(prisma.whatsAppInstance.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'DISCONNECTED', changed: false });
  });
});
