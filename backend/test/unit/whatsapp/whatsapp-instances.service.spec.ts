import type { ConfigService } from '@nestjs/config';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { EncryptionService } from '../../../src/infrastructure/crypto/encryption.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { EvolutionClient } from '../../../src/modules/whatsapp/evolution/evolution.client.js';
import type { WhatsAppContactSyncService } from '../../../src/modules/whatsapp/whatsapp-contact-sync.service.js';
import { WhatsAppInstanceLimitReachedError } from '../../../src/modules/whatsapp/whatsapp.errors.js';
import { WhatsAppInstancesService } from '../../../src/modules/whatsapp/whatsapp-instances.service.js';

interface EvolutionMock {
  configured: boolean;
  setWebhook: ReturnType<typeof vi.fn>;
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
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
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
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
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
        'GROUPS_UPSERT',
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
