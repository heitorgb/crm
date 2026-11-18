import type { ConfigService } from '@nestjs/config';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { EncryptionService } from '../../../src/infrastructure/crypto/encryption.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import {
  EvolutionRequestError,
  type EvolutionClient,
} from '../../../src/modules/whatsapp/evolution/evolution.client.js';
import type { WhatsAppContactSyncService } from '../../../src/modules/whatsapp/whatsapp-contact-sync.service.js';
import {
  WhatsAppConnectionInProgressError,
  WhatsAppInstanceLimitReachedError,
} from '../../../src/modules/whatsapp/whatsapp.errors.js';
import {
  normalizeOwnerNumber,
  WhatsAppInstancesService,
} from '../../../src/modules/whatsapp/whatsapp-instances.service.js';

interface EvolutionMock {
  configured: boolean;
  setWebhook: ReturnType<typeof vi.fn>;
  createInstance: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  deleteInstance: ReturnType<typeof vi.fn>;
  instanceExists: ReturnType<typeof vi.fn>;
  fetchInstances: ReturnType<typeof vi.fn>;
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
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  evolution: EvolutionMock;
  realtime: {
    emitToTenant: ReturnType<typeof vi.fn>;
    emitToTenantAdmins: ReturnType<typeof vi.fn>;
  };
  config: Record<string, unknown>;
}

const DEFAULT_ENV: Record<string, unknown> = {
  WHATSAPP_CONNECT_FLOW_GRACE_MS: 20_000,
  WHATSAPP_DISCONNECT_CONFIRM_TIMEOUT_MS: 250,
  WHATSAPP_CONNECTION_CONFIRM_READS: 3,
  WHATSAPP_CONNECTION_CONFIRM_INTERVAL_MS: 0,
  WHATSAPP_QR_CACHE_TTL_MS: 60_000,
  WHATSAPP_INSTANCE_RECONCILE_INTERVAL_MS: 60_000,
  WHATSAPP_AUTO_RECREATE_STALE_SESSION: false,
};

function createHarness(env: Record<string, unknown>, evolutionConfigured = true): Harness {
  const configValues = { ...DEFAULT_ENV, ...env };
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
    fetchInstances: vi.fn().mockResolvedValue([]),
    getConnectionState: vi.fn().mockResolvedValue({ instance: 'inst-1', state: 'close' }),
  };
  const config = {
    get: vi.fn((key: string) => configValues[key]),
    getOrThrow: vi.fn((key: string) => configValues[key]),
  };

  const contactSync = { enqueue: vi.fn().mockResolvedValue(undefined) };

  const tenantContext = {
    requireContext: vi.fn(() => ({ tenantId: 't1' })),
    run: vi.fn((_store: unknown, callback: () => unknown) => callback()),
  };

  const realtime = {
    emitToTenant: vi.fn(),
    emitToTenantAdmins: vi.fn(),
  };

  const service = new WhatsAppInstancesService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    { available: false } as unknown as EncryptionService,
    evolution as unknown as EvolutionClient,
    contactSync as unknown as WhatsAppContactSyncService,
    realtime as unknown as RealtimeService,
    config as unknown as ConfigService<Env, true>,
  );

  return { service, prisma, evolution, realtime, config: configValues };
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
        'QRCODE_UPDATED',
        'STATUS_INSTANCE',
        'LOGOUT_INSTANCE',
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

describe('WhatsAppInstancesService connection state machine', () => {
  const row = {
    id: 'i1',
    tenantId: 't1',
    instanceName: 'inst-1',
    status: 'CONNECTED',
    connectionObservedAt: null,
    connectionRequestedAt: null,
    connectionStatusReason: null,
    connectionVersion: 3,
    connectionStateVersion: 3,
    connectionIntent: 'NONE',
  };

  function seed(prisma: Harness['prisma'], overrides: Record<string, unknown> = {}): void {
    prisma.whatsAppInstance.findUnique.mockResolvedValue({ ...row, ...overrides });
  }

  it('keeps CONNECTED when a delayed close webhook is contradicted by the live snapshot', async () => {
    const { service, prisma, evolution, realtime } = createHarness({});
    seed(prisma);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
      eventType: 'connection.update',
      observedAt: new Date('2026-11-17T10:00:00Z'),
      receivedAt: new Date('2026-11-17T10:00:05Z'),
    });

    expect(result).toMatchObject({ status: 'CONNECTED', changed: false });
    expect(evolution.getConnectionState).toHaveBeenCalledTimes(1);
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONNECTED' }),
      }),
    );
  });

  it('does not reconnect a deliberately disconnected instance from a delayed open webhook', async () => {
    const { service, prisma, evolution } = createHarness({});
    seed(prisma, { status: 'DISCONNECTED', connectionIntent: 'DISCONNECT' });

    const result = await service.applyConnectionObservation('inst-1', 'open', {
      source: 'webhook',
      eventType: 'connection.update',
    });

    expect(result).toMatchObject({ status: 'DISCONNECTED', changed: false, ignored: true });
    expect(evolution.getConnectionState).not.toHaveBeenCalled();
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('recovers when a delayed logout is contradicted by a live open snapshot', async () => {
    const { service, prisma, evolution } = createHarness({});
    seed(prisma);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
      eventType: 'logout.instance',
    });

    expect(result).toMatchObject({ status: 'CONNECTED', changed: false });
  });

  it('does not disconnect on a single transient close followed by open', async () => {
    const { service, prisma, evolution } = createHarness({});
    seed(prisma);
    evolution.getConnectionState
      .mockResolvedValueOnce({ instance: 'inst-1', state: 'close' })
      .mockResolvedValueOnce({ instance: 'inst-1', state: 'open' });

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
    });

    expect(result).toMatchObject({ status: 'CONNECTED', changed: false });
    expect(evolution.getConnectionState).toHaveBeenCalledTimes(2);
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISCONNECTED' }) }),
    );
  });

  it('persists DISCONNECTED only after consecutive negative snapshots', async () => {
    const { service, prisma, evolution, realtime } = createHarness({});
    seed(prisma);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'close' });

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
      reason: 401,
    });

    expect(result).toMatchObject({ status: 'DISCONNECTED', changed: true });
    expect(evolution.getConnectionState).toHaveBeenCalledTimes(3);
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1', connectionStateVersion: { lt: 3 } },
        data: expect.objectContaining({
          status: 'DISCONNECTED',
          connectionStatusReason: 401,
          connectionRequestedAt: null,
          connectionStateVersion: 3,
        }),
      }),
    );
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      't1',
      'whatsapp.instance.updated',
      expect.objectContaining({ instanceId: 'i1', status: 'DISCONNECTED', reason: 401 }),
    );
  });

  it('preserves the last confirmed state when the provider is unavailable', async () => {
    const { service, prisma, evolution } = createHarness({});
    seed(prisma);
    evolution.getConnectionState.mockRejectedValue(new EvolutionRequestError('timeout'));

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
    });

    expect(result).toMatchObject({ status: 'CONNECTED', changed: false, ignored: true });
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('treats an invalid or missing instance.state as indeterminate', async () => {
    const { service, prisma, evolution } = createHarness({});
    seed(prisma);
    evolution.getConnectionState.mockResolvedValue({
      instance: 'inst-1',
      state: 'unknown',
      kind: 'invalid',
    });

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
    });

    expect(result).toMatchObject({ status: 'CONNECTED', changed: false, ignored: true });
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('lets a newer generation win over a slower, older verification', async () => {
    const { service, prisma } = createHarness({});
    seed(prisma);
    prisma.whatsAppInstance.updateMany.mockResolvedValue({ count: 0 });
    prisma.whatsAppInstance.findUnique
      .mockResolvedValueOnce({ ...row, connectionVersion: 3, connectionStateVersion: 3 })
      .mockResolvedValueOnce({ ...row, connectionVersion: 3, connectionStateVersion: 3 })
      .mockResolvedValueOnce({
        ...row,
        status: 'CONNECTED',
        connectionVersion: 9,
        connectionStateVersion: 9,
      });

    const result = await service.applyConnectionObservation('inst-1', 'open', {
      source: 'webhook',
    });

    expect(result).toMatchObject({
      status: 'CONNECTED',
      changed: false,
      ignored: true,
      version: 9,
    });
  });

  it('does not let an inconclusive concurrent verification block a confirmed close', async () => {
    const { service, prisma, evolution } = createHarness({});
    seed(prisma, { connectionVersion: 5, connectionStateVersion: 2 });
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'close' });

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
      reason: 401,
    });

    expect(result).toMatchObject({ status: 'DISCONNECTED', changed: true });
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1', connectionStateVersion: { lt: 5 } },
        data: expect.objectContaining({
          status: 'DISCONNECTED',
          connectionStateVersion: 5,
        }),
      }),
    );
  });

  it('ignores a missing state or unknown instance', async () => {
    const { service, prisma } = createHarness({});

    expect(await service.applyConnectionObservation('inst-1', null)).toBeNull();
    expect(prisma.whatsAppInstance.findUnique).not.toHaveBeenCalled();

    prisma.whatsAppInstance.findUnique.mockResolvedValue(null);
    expect(await service.applyConnectionObservation('missing', 'close')).toBeNull();
  });

  it('ignores a transient close during a fresh connect attempt', async () => {
    const { service, prisma, evolution } = createHarness({});
    seed(prisma, {
      status: 'CONNECTING',
      connectionRequestedAt: new Date(),
      connectionVersion: 4,
    });
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'close' });

    const result = await service.applyConnectionObservation('inst-1', 'close', {
      source: 'webhook',
    });

    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'CONNECTING', changed: false });
  });

  it('does not consider close definitive when Evolution remains unavailable on poll', async () => {
    const { service, prisma, evolution } = createHarness({});
    evolution.getConnectionState.mockRejectedValue(new EvolutionRequestError('timeout'));
    prisma.whatsAppInstance.findFirst.mockResolvedValue(row);
    seed(prisma);

    await expect(service.refreshStatus('i1')).rejects.toBeInstanceOf(EvolutionRequestError);
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the persisted state when the provider reports an unknown state on poll', async () => {
    const { service, prisma, evolution } = createHarness({});
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'unknown' });
    prisma.whatsAppInstance.findFirst.mockResolvedValue(row);
    seed(prisma);

    await expect(service.refreshStatus('i1')).resolves.toEqual({
      status: 'CONNECTED',
      reason: null,
    });
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });
});

describe('WhatsAppInstancesService send preflight', () => {
  const row = {
    id: 'i1',
    tenantId: 't1',
    instanceName: 'inst-1',
    status: 'DISCONNECTED',
    connectionObservedAt: null,
    connectionRequestedAt: null,
    connectionStatusReason: null,
    connectionVersion: 2,
    connectionStateVersion: 2,
    connectionIntent: 'CONNECT',
  };

  it('repairs a stale DISCONNECTED state when the session is open', async () => {
    const { service, prisma, evolution, realtime } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(row);
    prisma.whatsAppInstance.findUnique.mockResolvedValue(row);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });

    await expect(service.ensureConnectedForSend('t1', 'i1')).resolves.toBe(true);

    expect(evolution.getConnectionState).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONNECTED' }),
      }),
    );
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      't1',
      'whatsapp.instance.updated',
      expect.objectContaining({ instanceId: 'i1', status: 'CONNECTED' }),
    );
  });

  it('does not touch the provider when the persisted state is already CONNECTED', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue({ ...row, status: 'CONNECTED' });

    await expect(service.ensureConnectedForSend('t1', 'i1')).resolves.toBe(true);
    expect(evolution.getConnectionState).not.toHaveBeenCalled();
  });

  it('blocks the send when the live snapshot is closed', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(row);
    prisma.whatsAppInstance.findUnique.mockResolvedValue(row);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'close' });

    await expect(service.ensureConnectedForSend('t1', 'i1')).resolves.toBe(false);
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('does not recover a manually disconnected instance', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue({
      ...row,
      connectionIntent: 'DISCONNECT',
    });

    await expect(service.ensureConnectedForSend('t1', 'i1')).resolves.toBe(false);
    expect(evolution.getConnectionState).not.toHaveBeenCalled();
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
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1' },
        data: expect.objectContaining({
          status: 'CONNECTING',
          connectionStatusReason: null,
          connectionIntent: 'CONNECT',
        }),
      }),
    );
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
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1' },
        data: expect.objectContaining({ status: 'CONNECTED', connectionIntent: 'CONNECT' }),
      }),
    );
    expect(result.status).toBe('CONNECTED');
  });

  it('recreates an existing instance only as a last resort when explicitly enabled', async () => {
    const { service, prisma, evolution } = createHarness({
      WHATSAPP_AUTO_RECREATE_STALE_SESSION: true,
    });
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.instanceExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    evolution.connect.mockResolvedValue({ error: true, message: 'instance does not exist' });

    const result = await service.connect('i1');

    expect(evolution.connect).toHaveBeenCalledTimes(2);
    expect(evolution.deleteInstance).toHaveBeenCalledWith('inst-1');
    expect(evolution.createInstance).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('CONNECTING');
  });

  it('does not delete the provider instance when recreation is disabled', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.instanceExists.mockResolvedValue(true);
    evolution.connect.mockResolvedValue({ error: true, message: 'no ticket' });

    await expect(service.connect('i1')).rejects.toBeInstanceOf(EvolutionRequestError);
    expect(evolution.connect).toHaveBeenCalledTimes(2);
    expect(evolution.deleteInstance).not.toHaveBeenCalled();
  });

  it('rejects a second concurrent operation for the same instance', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findFirst.mockResolvedValue(instanceRow);
    evolution.instanceExists.mockResolvedValue(true);

    let release: (value: unknown) => void = () => undefined;
    evolution.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = service.connect('i1');
    await expect(service.connect('i1')).rejects.toBeInstanceOf(WhatsAppConnectionInProgressError);

    release({ qrcode: { base64: 'ZXhpc3Rpbmc=' }, code: '2@existing' });
    await expect(first).resolves.toMatchObject({ status: 'CONNECTING' });
    expect(evolution.connect).toHaveBeenCalledTimes(1);
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
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      ...instanceRow,
      status: 'CONNECTED',
      connectionObservedAt: null,
      connectionRequestedAt: null,
    });

    await expect(service.disconnect('i1')).resolves.toEqual({ status: 'DISCONNECTED' });

    expect(evolution.disconnect).toHaveBeenCalledWith('inst-1');
    expect(evolution.getConnectionState).toHaveBeenCalledWith('inst-1');
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1' },
        data: expect.objectContaining({
          status: 'DISCONNECTED',
          connectionIntent: 'DISCONNECT',
        }),
      }),
    );
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
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      ...instanceRow,
      status: 'CONNECTED',
      connectionObservedAt: null,
      connectionRequestedAt: null,
    });
    evolution.disconnect.mockRejectedValue(new EvolutionRequestError('timeout'));

    await expect(service.disconnect('i1')).resolves.toEqual({ status: 'DISCONNECTED' });
    expect(prisma.whatsAppInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1' },
        data: expect.objectContaining({
          status: 'DISCONNECTED',
          connectionIntent: 'DISCONNECT',
        }),
      }),
    );
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
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'i1' }),
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
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
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
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'i1' }),
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

  it('persists the real chunk order, provider message count and last update', async () => {
    const { service, prisma } = createHarness({});
    const observedAt = new Date('2026-10-29T13:48:04.000Z');
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'SYNCING',
      historySyncProgress: 77,
      historySyncChunks: 13,
      historySyncMessages: null,
      historySyncStartedAt: new Date('2026-10-29T13:36:00.000Z'),
      historySyncCompletedAt: null,
      historySyncUpdatedAt: new Date('2026-10-29T13:47:00.000Z'),
      historySyncError: null,
    });

    const result = await service.applyHistorySyncUpdate('inst-1', {
      progress: 83,
      chunks: 14,
      observedAt,
    });

    expect(result).toMatchObject({
      status: 'SYNCING',
      progress: 83,
      chunks: 14,
      updatedAt: observedAt,
      changed: true,
    });
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'i1' }),
      data: expect.objectContaining({
        historySyncProgress: 83,
        historySyncChunks: 14,
        historySyncUpdatedAt: observedAt,
      }),
    });

    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'SYNCING',
      historySyncProgress: 83,
      historySyncChunks: 14,
      historySyncMessages: null,
      historySyncStartedAt: new Date('2026-10-29T13:36:00.000Z'),
      historySyncCompletedAt: null,
      historySyncUpdatedAt: observedAt,
      historySyncError: null,
    });

    const completed = await service.applyHistorySyncUpdate('inst-1', {
      progress: 100,
      messages: 82744,
      observedAt: new Date('2026-10-29T13:51:04.000Z'),
      completed: true,
    });

    expect(completed).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
      messages: 82744,
      completedAt: new Date('2026-10-29T13:51:04.000Z'),
      changed: true,
    });
  });

  it('ignores an event older than the last applied sync update', async () => {
    const { service, prisma } = createHarness({});
    const lastUpdate = new Date('2026-10-29T13:48:04.000Z');
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'SYNCING',
      historySyncProgress: 83,
      historySyncChunks: 14,
      historySyncMessages: null,
      historySyncStartedAt: new Date('2026-10-29T13:36:00.000Z'),
      historySyncCompletedAt: null,
      historySyncUpdatedAt: lastUpdate,
      historySyncError: null,
    });

    const result = await service.applyHistorySyncUpdate('inst-1', {
      progress: 20,
      chunks: 3,
      observedAt: new Date('2026-10-29T13:40:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'SYNCING',
      progress: 83,
      chunks: 14,
      changed: false,
    });
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer state when it loses the update race', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique
      .mockResolvedValueOnce({
        id: 'i1',
        tenantId: 't1',
        historySyncStatus: 'SYNCING',
        historySyncProgress: 40,
        historySyncChunks: 5,
        historySyncMessages: null,
        historySyncStartedAt: new Date('2026-10-29T13:36:00.000Z'),
        historySyncCompletedAt: null,
        historySyncUpdatedAt: null,
        historySyncError: null,
      })
      .mockResolvedValueOnce({
        id: 'i1',
        tenantId: 't1',
        historySyncStatus: 'SYNCING',
        historySyncProgress: 90,
        historySyncChunks: 15,
        historySyncMessages: null,
        historySyncStartedAt: new Date('2026-10-29T13:36:00.000Z'),
        historySyncCompletedAt: null,
        historySyncUpdatedAt: new Date('2026-10-29T13:50:00.000Z'),
        historySyncError: null,
      });
    prisma.whatsAppInstance.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.applyHistorySyncUpdate('inst-1', {
      progress: 50,
      chunks: 6,
      observedAt: new Date('2026-10-29T13:48:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'SYNCING',
      progress: 90,
      chunks: 15,
      changed: false,
    });
  });

  it('does not reopen a completed sync from an older duplicate batch', async () => {
    const { service, prisma } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      historySyncStatus: 'COMPLETED',
      historySyncProgress: 100,
      historySyncChunks: 17,
      historySyncMessages: 82744,
      historySyncStartedAt: new Date('2026-10-29T13:36:00.000Z'),
      historySyncCompletedAt: new Date('2026-10-29T13:51:04.000Z'),
      historySyncUpdatedAt: new Date('2026-10-29T13:51:04.000Z'),
      historySyncError: null,
    });

    const result = await service.applyHistorySyncUpdate('inst-1', {
      progress: 30,
      observedAt: new Date('2026-10-29T13:40:00.000Z'),
    });

    expect(result).toMatchObject({ status: 'COMPLETED', progress: 100, changed: false });
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('recovers a persisted syncing state after a backend restart', async () => {
    const { service, prisma } = createHarness({});
    const persisted = {
      id: 'i1',
      name: 'Caio',
      instanceName: 'inst-1',
      externalInstanceId: null,
      phone: null,
      status: 'CONNECTED',
      connectionObservedAt: null,
      active: true,
      credentialsEncrypted: null,
      historySyncStatus: 'SYNCING',
      historySyncProgress: 65,
      historySyncChunks: 7,
      historySyncMessages: null,
      historySyncStartedAt: new Date('2026-10-29T13:36:00.000Z'),
      historySyncCompletedAt: null,
      historySyncUpdatedAt: new Date('2026-10-29T13:45:00.000Z'),
      historySyncError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.whatsAppInstance.findMany.mockResolvedValue([persisted]);
    prisma.whatsAppInstance.count.mockResolvedValue(1);

    const result = await service.list({ page: 1, perPage: 20, order: 'desc' });

    expect(result.data[0].historySync).toMatchObject({
      status: 'SYNCING',
      progress: 65,
      chunks: 7,
      completedAt: null,
    });
  });
});

describe('WhatsAppInstancesService QR cache', () => {
  it('emits a rotated QR only to the tenant administrators', async () => {
    const { service, realtime } = createHarness({});
    const instance = { id: 'i1', tenantId: 't1', instanceName: 'inst-1' };

    await service.applyProviderQr(
      instance,
      { qrcode: { base64: 'ZmFrZS1xcg==', code: '2@new', pairingCode: '12345678' } },
      new Date(),
    );

    expect(realtime.emitToTenantAdmins).toHaveBeenCalledWith(
      't1',
      'whatsapp.instance.qr',
      expect.objectContaining({
        instanceId: 'i1',
        code: '2@new',
        pairingCode: '12345678',
        qrCodeBase64: expect.stringContaining('data:image/png;base64,'),
      }),
    );
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
    expect(service.getConnectionQr('i1')).toMatchObject({ code: '2@new' });
  });

  it('ignores a QR event older than the cached one', async () => {
    const { service, realtime } = createHarness({});
    const instance = { id: 'i1', tenantId: 't1', instanceName: 'inst-1' };

    const now = Date.now();
    await service.applyProviderQr(
      instance,
      { qrcode: { base64: 'bm92bw==', code: '2@new' } },
      new Date(now),
    );
    await service.applyProviderQr(
      instance,
      { qrcode: { base64: 'YW50aWdv', code: '2@old' } },
      new Date(now - 5_000),
    );

    expect(realtime.emitToTenantAdmins).toHaveBeenCalledTimes(1);
    expect(service.getConnectionQr('i1')).toMatchObject({ code: '2@new' });
  });

  it('drops the cached QR after the TTL', async () => {
    const { service } = createHarness({ WHATSAPP_QR_CACHE_TTL_MS: 1 });
    const instance = { id: 'i1', tenantId: 't1', instanceName: 'inst-1' };

    await service.applyProviderQr(
      instance,
      { qrcode: { base64: 'ZmFrZS1xcg==', code: '2@new' } },
      new Date(Date.now() - 10),
    );

    expect(service.getConnectionQr('i1')).toBeNull();
  });
});

describe('WhatsAppInstancesService connection reconciliation', () => {
  const row = {
    id: 'i1',
    tenantId: 't1',
    instanceName: 'inst-1',
    status: 'CONNECTED',
    connectionObservedAt: null,
    connectionRequestedAt: null,
    connectionStatusReason: null,
    connectionVersion: 1,
    connectionStateVersion: 1,
    connectionIntent: 'NONE',
  };

  function scan(prisma: Harness['prisma']): void {
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i1', tenantId: 't1', instanceName: 'inst-1', status: row.status },
    ]);
    prisma.whatsAppInstance.findUnique.mockResolvedValue(row);
  }

  it('preserves the state when the provider instance is unknown or missing', async () => {
    const { service, prisma, evolution, realtime } = createHarness({});
    scan(prisma);
    evolution.getConnectionState.mockResolvedValue({
      instance: 'inst-1',
      state: 'unknown',
      kind: 'not_found',
    });

    await service.reconcileConnectionStates();

    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('keeps the persisted state when Evolution is unavailable', async () => {
    const { service, prisma, evolution } = createHarness({});
    scan(prisma);
    evolution.getConnectionState.mockRejectedValue(new EvolutionRequestError('timeout'));

    await expect(service.reconcileConnectionStates()).resolves.toBeUndefined();

    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('does not downgrade a fresh connecting attempt on a transient close', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i1', tenantId: 't1', instanceName: 'inst-1', status: 'CONNECTING' },
    ]);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'close' });
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      ...row,
      status: 'CONNECTING',
      connectionRequestedAt: new Date(),
    });

    await service.reconcileConnectionStates();

    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });

  it('persists DISCONNECTED after repeated valid closes', async () => {
    const { service, prisma, evolution, realtime } = createHarness({});
    scan(prisma);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'close' });

    await service.reconcileConnectionStates();

    expect(evolution.getConnectionState).toHaveBeenCalledTimes(3);
    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DISCONNECTED' }),
      }),
    );
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      't1',
      'whatsapp.instance.updated',
      expect.objectContaining({ instanceId: 'i1', status: 'DISCONNECTED' }),
    );
  });
});

describe('WhatsAppInstancesService duplicate sessions', () => {
  const disconnectedRow = {
    id: 'i1',
    tenantId: 't1',
    instanceName: 'inst-1',
    status: 'DISCONNECTED',
    connectionObservedAt: null,
    connectionRequestedAt: new Date(),
  };

  it('normalizes the owner jid to the phone number', () => {
    expect(normalizeOwnerNumber('5511999999999:12@s.whatsapp.net')).toBe('5511999999999');
    expect(normalizeOwnerNumber('5511999999999@s.whatsapp.net')).toBe('5511999999999');
    expect(normalizeOwnerNumber(null)).toBeNull();
    expect(normalizeOwnerNumber('@s.whatsapp.net')).toBeNull();
  });

  it('logs out an orphan provider session of the same number when the instance connects', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue(disconnectedRow);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });
    evolution.fetchInstances.mockResolvedValue([
      { name: 'inst-1', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
      { name: 'old-inst', state: 'open', ownerJid: '5511999999999:3@s.whatsapp.net' },
      { name: 'other-number', state: 'open', ownerJid: '5511888888888@s.whatsapp.net' },
      { name: 'closed-inst', state: 'close', ownerJid: '5511999999999@s.whatsapp.net' },
    ]);

    await service.applyConnectionObservation('inst-1', 'open', { source: 'webhook' });

    expect(evolution.disconnect).toHaveBeenCalledTimes(1);
    expect(evolution.disconnect).toHaveBeenCalledWith('old-inst');
  });

  it('marks a same-tenant duplicate as disconnected with the replaced reason', async () => {
    const { service, prisma, evolution, realtime } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockImplementation(
      ({ where }: { where: { instanceName?: string; id?: string } }) =>
        Promise.resolve(
          where.instanceName === 'inst-2' || where.id === 'i2'
            ? { ...disconnectedRow, id: 'i2', instanceName: 'inst-2', status: 'CONNECTED' }
            : disconnectedRow,
        ),
    );
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i2', tenantId: 't1', instanceName: 'inst-2' },
    ]);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });
    evolution.fetchInstances.mockResolvedValue([
      { name: 'inst-1', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
      { name: 'inst-2', state: 'connecting', ownerJid: '5511999999999@s.whatsapp.net' },
    ]);

    await service.applyConnectionObservation('inst-1', 'open', { source: 'webhook' });

    expect(evolution.disconnect).toHaveBeenCalledWith('inst-2');
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      't1',
      'whatsapp.instance.updated',
      expect.objectContaining({ instanceId: 'i2', status: 'DISCONNECTED', reason: 440 }),
    );
  });

  it('never logs out a session that belongs to another tenant', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue(disconnectedRow);
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i9', tenantId: 't2', instanceName: 'foreign' },
    ]);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });
    evolution.fetchInstances.mockResolvedValue([
      { name: 'inst-1', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
      { name: 'foreign', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
    ]);

    await service.applyConnectionObservation('inst-1', 'open', { source: 'webhook' });

    expect(evolution.disconnect).not.toHaveBeenCalled();
  });

  it('keeps the connection observation when the duplicate check fails', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue(disconnectedRow);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });
    evolution.fetchInstances.mockRejectedValue(new Error('evolution down'));

    const result = await service.applyConnectionObservation('inst-1', 'open', {
      source: 'webhook',
    });

    expect(result).toMatchObject({ status: 'CONNECTED', changed: true });
    expect(evolution.disconnect).not.toHaveBeenCalled();
  });
});

describe('WhatsAppInstancesService duplicate sessions during reconciliation', () => {
  it('releases a silently flapping duplicate while the instance stays connected', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findMany
      .mockResolvedValueOnce([{ id: 'i1', tenantId: 't1', instanceName: 'inst-1' }])
      .mockResolvedValueOnce([]);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });
    prisma.whatsAppInstance.findUnique.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      instanceName: 'inst-1',
      status: 'CONNECTED',
      connectionObservedAt: null,
      connectionRequestedAt: new Date(),
    });
    evolution.fetchInstances.mockResolvedValue([
      { name: 'inst-1', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
      { name: 'leftover', state: 'connecting', ownerJid: '5511999999999@s.whatsapp.net' },
    ]);

    await service.reconcileConnectionStates();

    expect(prisma.whatsAppInstance.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: { connectionRequestedAt: { sort: 'desc', nulls: 'last' } },
      }),
    );
    expect(evolution.fetchInstances).toHaveBeenCalledTimes(1);
    expect(evolution.disconnect).toHaveBeenCalledWith('leftover');
  });

  it('keeps the first scanned instance when two connected instances share the number', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findMany.mockImplementation(
      (args: { where: { instanceName?: unknown } }) =>
        Promise.resolve(
          args.where.instanceName
            ? [{ id: 'i2', tenantId: 't1', instanceName: 'inst-2' }]
            : [
                { id: 'i1', tenantId: 't1', instanceName: 'inst-1' },
                { id: 'i2', tenantId: 't1', instanceName: 'inst-2' },
              ],
        ),
    );
    const rows: Record<string, { status: string }> = {
      'inst-1': { status: 'CONNECTED' },
      'inst-2': { status: 'CONNECTED' },
    };
    prisma.whatsAppInstance.findUnique.mockImplementation(
      ({ where }: { where: { instanceName?: string; id?: string } }) => {
        const name = where.instanceName ?? (where.id === 'i2' ? 'inst-2' : 'inst-1');
        return Promise.resolve({
          id: name === 'inst-2' ? 'i2' : 'i1',
          tenantId: 't1',
          instanceName: name,
          status: rows[name]?.status,
          connectionObservedAt: null,
          connectionRequestedAt: null,
        });
      },
    );
    prisma.whatsAppInstance.updateMany.mockImplementation(
      ({ where, data }: { where: { id: string }; data: { status?: string } }) => {
        const name = where.id === 'i2' ? 'inst-2' : 'inst-1';
        if (data.status) rows[name] = { status: data.status };
        return Promise.resolve({ count: 1 });
      },
    );
    evolution.fetchInstances.mockResolvedValue([
      { name: 'inst-1', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
      { name: 'inst-2', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
    ]);
    evolution.getConnectionState.mockImplementation((name: string) =>
      Promise.resolve({
        instance: name,
        state: name === 'inst-2' && evolution.disconnect.mock.calls.length > 0 ? 'close' : 'open',
      }),
    );

    await service.reconcileConnectionStates();

    expect(evolution.disconnect).toHaveBeenCalledTimes(1);
    expect(evolution.disconnect).toHaveBeenCalledWith('inst-2');
    expect(rows['inst-1']?.status).toBe('CONNECTED');
    expect(rows['inst-2']?.status).toBe('DISCONNECTED');
  });
});

describe('WhatsAppInstancesService recovery after a provider reconnect', () => {
  const disconnected = {
    id: 'i1',
    tenantId: 't1',
    instanceName: 'inst-1',
    status: 'DISCONNECTED',
    connectionObservedAt: null,
    connectionRequestedAt: null,
    connectionStatusReason: null,
    connectionVersion: 2,
    connectionStateVersion: 2,
    connectionIntent: 'CONNECT',
  };

  it('restores the instance when an open webhook is confirmed by a live read', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue(disconnected);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });

    const result = await service.applyConnectionObservation('inst-1', 'open', {
      source: 'webhook',
    });

    expect(result).toMatchObject({ status: 'CONNECTED', changed: true });
  });

  it('still ignores a delayed open webhook when the provider session is closed', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findUnique.mockResolvedValue(disconnected);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'close' });

    const result = await service.applyConnectionObservation('inst-1', 'open', {
      source: 'webhook',
    });

    expect(result).toMatchObject({ status: 'DISCONNECTED', changed: false });
    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONNECTED' }) }),
    );
  });

  it('reconciliation restores a disconnected instance the provider reopened', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i1', tenantId: 't1', instanceName: 'inst-1', status: 'DISCONNECTED' },
    ]);
    prisma.whatsAppInstance.findUnique.mockResolvedValue(disconnected);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'open' });

    await service.reconcileConnectionStates();

    expect(prisma.whatsAppInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONNECTED' }) }),
    );
  });

  it('reconciliation leaves a disconnected instance alone while the provider is not open', async () => {
    const { service, prisma, evolution } = createHarness({});
    prisma.whatsAppInstance.findMany.mockResolvedValue([
      { id: 'i1', tenantId: 't1', instanceName: 'inst-1', status: 'DISCONNECTED' },
    ]);
    evolution.getConnectionState.mockResolvedValue({ instance: 'inst-1', state: 'connecting' });

    await service.reconcileConnectionStates();

    expect(prisma.whatsAppInstance.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * Reproduces Evolution 2.4.0-rc2: after a recoverable close the provider makes a
 * single reconnect attempt and, when it fails, stays `close` without any webhook
 * while the stored session is still valid. A plain `/instance/connect` restores
 * it without a QR code; when the session was lost it starts a QR cycle instead.
 */
describe('WhatsAppInstancesService automatic restore of an abandoned session', () => {
  interface FakeRow {
    id: string;
    tenantId: string;
    instanceName: string;
    status: string;
    active: boolean;
    connectionObservedAt: Date | null;
    connectionRequestedAt: Date | null;
    connectionStatusReason: number | null;
    connectionVersion: number;
    connectionStateVersion: number;
    connectionIntent: string;
  }

  interface FakeProvider {
    state: string;
    ownerJid: string | null;
    sessionStored: boolean;
  }

  const RESTORE_ENV = {
    WHATSAPP_AUTO_RESTORE_ENABLED: true,
    WHATSAPP_AUTO_RESTORE_MIN_CLOSED_MS: 30_000,
    WHATSAPP_AUTO_RESTORE_WAIT_MS: 300,
  };

  function setup(
    rowOverrides: Partial<FakeRow> = {},
    providerOverrides: Partial<FakeProvider> = {},
    env: Record<string, unknown> = {},
  ) {
    const harness = createHarness({ ...RESTORE_ENV, ...env });
    const row: FakeRow = {
      id: 'i1',
      tenantId: 't1',
      instanceName: 'inst-1',
      status: 'DISCONNECTED',
      active: true,
      connectionObservedAt: new Date(Date.now() - 120_000),
      connectionRequestedAt: null,
      connectionStatusReason: null,
      connectionVersion: 5,
      connectionStateVersion: 5,
      connectionIntent: 'NONE',
      ...rowOverrides,
    };
    const provider: FakeProvider = {
      state: 'close',
      ownerJid: '5511999999999@s.whatsapp.net',
      sessionStored: true,
      ...providerOverrides,
    };
    const { prisma, evolution, service } = harness;

    prisma.whatsAppInstance.findMany.mockImplementation((args: { where: { active?: boolean } }) =>
      Promise.resolve(
        args.where.active
          ? [
              {
                id: row.id,
                tenantId: row.tenantId,
                instanceName: row.instanceName,
                status: row.status,
                connectionIntent: row.connectionIntent,
                connectionStatusReason: row.connectionStatusReason,
                connectionObservedAt: row.connectionObservedAt,
              },
            ]
          : [],
      ),
    );
    prisma.whatsAppInstance.findUnique.mockImplementation(() => Promise.resolve({ ...row }));
    prisma.whatsAppInstance.findFirst.mockImplementation(() => Promise.resolve({ ...row }));
    prisma.whatsAppInstance.update.mockImplementation(
      (args: { data: { connectionVersion?: { increment: number } } }) => {
        if (args.data.connectionVersion) {
          row.connectionVersion += args.data.connectionVersion.increment;
        }
        return Promise.resolve({ ...row });
      },
    );
    prisma.whatsAppInstance.updateMany.mockImplementation(
      (args: { where: { connectionStateVersion?: { lt: number } }; data: Partial<FakeRow> }) => {
        const limit = args.where.connectionStateVersion?.lt;
        if (limit === undefined || row.connectionStateVersion >= limit) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(row, args.data);
        return Promise.resolve({ count: 1 });
      },
    );

    evolution.getConnectionState.mockImplementation(() =>
      Promise.resolve({ instance: row.instanceName, state: provider.state }),
    );
    evolution.fetchInstances.mockImplementation(() =>
      Promise.resolve([
        { name: row.instanceName, state: provider.state, ownerJid: provider.ownerJid },
      ]),
    );
    evolution.connect.mockImplementation(async () => {
      if (provider.sessionStored) {
        provider.state = 'open';
        return { count: 0 };
      }
      provider.state = 'connecting';
      await service.applyProviderQr(
        { id: row.id, tenantId: row.tenantId, instanceName: row.instanceName },
        { qrcode: { base64: 'cXI=', code: '2@qr' } },
        new Date(),
      );
      return { qrcode: { base64: 'cXI=' } };
    });

    return { ...harness, row, provider };
  }

  function allowNextAttempt(service: WhatsAppInstancesService): void {
    const states = (
      service as unknown as { restoreStates: Map<string, { nextAttemptAt: number }> }
    ).restoreStates;
    for (const state of states.values()) {
      state.nextAttemptAt = 0;
    }
  }

  it('restores a session the provider left closed, without a QR code', async () => {
    const { service, evolution, realtime, row } = setup();

    await service.reconcileConnectionStates();

    expect(evolution.connect).toHaveBeenCalledTimes(1);
    expect(evolution.connect).toHaveBeenCalledWith('inst-1');
    expect(row.status).toBe('CONNECTED');
    expect(row.connectionStatusReason).toBeNull();
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      't1',
      'whatsapp.instance.updated',
      expect.objectContaining({
        instanceId: 'i1',
        status: 'CONNECTED',
        previousStatus: 'DISCONNECTED',
      }),
    );
  });

  it('does not race the reconnect the provider makes right after the close', async () => {
    const { service, evolution, row } = setup({
      connectionObservedAt: new Date(Date.now() - 5_000),
    });

    await service.reconcileConnectionStates();

    expect(evolution.connect).not.toHaveBeenCalled();
    expect(row.status).toBe('DISCONNECTED');
  });

  it('never restores after a manual disconnect', async () => {
    const { service, evolution, row } = setup({ connectionIntent: 'DISCONNECT' });

    await service.reconcileConnectionStates();

    expect(evolution.connect).not.toHaveBeenCalled();
    expect(row.status).toBe('DISCONNECTED');
  });

  it.each([401, 403, 440])(
    'never restores a close that requires a new pairing (%i)',
    async (reason) => {
      const { service, evolution, row } = setup({ connectionStatusReason: reason });

      await service.reconcileConnectionStates();

      expect(evolution.connect).not.toHaveBeenCalled();
      expect(row.status).toBe('DISCONNECTED');
    },
  );

  it('does not restore an instance that was never paired', async () => {
    const { service, evolution } = setup({}, { ownerJid: null });

    await service.reconcileConnectionStates();

    expect(evolution.connect).not.toHaveBeenCalled();
  });

  it('leaves a provider that is already connecting alone', async () => {
    const { service, evolution } = setup({}, { state: 'connecting' });

    await service.reconcileConnectionStates();

    expect(evolution.connect).not.toHaveBeenCalled();
  });

  it('stops at the first QR code, because the provider lost the session', async () => {
    const { service, evolution, row } = setup({}, { sessionStored: false });

    await service.reconcileConnectionStates();
    allowNextAttempt(service);
    await service.reconcileConnectionStates();

    expect(evolution.connect).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('DISCONNECTED');
  });

  it('waits between attempts and gives up after three failed restores', async () => {
    const { service, evolution, row } = setup();
    evolution.connect.mockResolvedValue({ count: 0 });

    await service.reconcileConnectionStates();
    await service.reconcileConnectionStates();
    expect(evolution.connect).toHaveBeenCalledTimes(1);

    allowNextAttempt(service);
    await service.reconcileConnectionStates();
    allowNextAttempt(service);
    await service.reconcileConnectionStates();
    allowNextAttempt(service);
    await service.reconcileConnectionStates();

    expect(evolution.connect).toHaveBeenCalledTimes(3);
    expect(row.status).toBe('DISCONNECTED');
  });

  it('does not count an attempt when the provider cannot be reached', async () => {
    const { service, evolution, row, provider } = setup();
    evolution.connect
      .mockRejectedValueOnce(new EvolutionRequestError('Evolution API request failed'))
      .mockImplementationOnce(() => {
        provider.state = 'open';
        return Promise.resolve({ count: 0 });
      });

    await service.reconcileConnectionStates();
    await service.reconcileConnectionStates();

    expect(evolution.connect).toHaveBeenCalledTimes(2);
    expect(row.status).toBe('CONNECTED');
  });

  it('counts a connect the provider answers with an error body', async () => {
    const { service, evolution, row } = setup();
    evolution.connect.mockResolvedValue({ error: true, message: 'Error: Connection Failure' });

    await service.reconcileConnectionStates();
    await service.reconcileConnectionStates();

    expect(evolution.connect).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('DISCONNECTED');
  });

  it('keeps the close reason reported by the provider across periodic reads', async () => {
    const { service, row } = setup({ connectionStatusReason: 408 }, { ownerJid: null });

    await service.reconcileConnectionStates();

    expect(row.status).toBe('DISCONNECTED');
    expect(row.connectionStatusReason).toBe(408);
  });

  it('restores the session when an agent sends and lets the send proceed', async () => {
    const { service, evolution, row } = setup();

    await expect(service.ensureConnectedForSend('t1', 'i1')).resolves.toBe(true);

    expect(evolution.connect).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('CONNECTED');
  });

  it('restores on a send right after a periodic read refreshed the close timestamp', async () => {
    const { service, evolution, row } = setup();
    evolution.connect.mockRejectedValueOnce(new EvolutionRequestError('Evolution API request failed'));

    await service.reconcileConnectionStates();
    expect(Date.now() - (row.connectionObservedAt?.getTime() ?? 0)).toBeLessThan(5_000);

    await expect(service.ensureConnectedForSend('t1', 'i1')).resolves.toBe(true);
    expect(evolution.connect).toHaveBeenCalledTimes(2);
    expect(row.status).toBe('CONNECTED');
  });

  it('never runs two restores of the same session at the same time', async () => {
    const { service, evolution, row } = setup();
    const restore = (
      service as unknown as {
        restoreAbandonedSession: (
          candidate: FakeRow,
          trigger: 'reconcile' | 'send',
          snapshot: unknown[] | null,
        ) => Promise<boolean>;
      }
    ).restoreAbandonedSession.bind(service);
    const snapshot = [
      { name: 'inst-1', state: 'close', ownerJid: '5511999999999@s.whatsapp.net' },
    ];

    const results = await Promise.all([
      restore({ ...row }, 'reconcile', snapshot),
      restore({ ...row }, 'send', snapshot),
    ]);

    expect(evolution.connect).toHaveBeenCalledTimes(1);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(row.status).toBe('CONNECTED');
  });

  it('blocks the send without restoring inside the provider reconnect window', async () => {
    const { service, evolution } = setup({ connectionObservedAt: new Date(Date.now() - 2_000) });

    await expect(service.ensureConnectedForSend('t1', 'i1')).resolves.toBe(false);

    expect(evolution.connect).not.toHaveBeenCalled();
  });

  it('does nothing when automatic restore is disabled', async () => {
    const { service, evolution } = setup({}, {}, { WHATSAPP_AUTO_RESTORE_ENABLED: false });

    await service.reconcileConnectionStates();

    expect(evolution.connect).not.toHaveBeenCalled();
  });
});
