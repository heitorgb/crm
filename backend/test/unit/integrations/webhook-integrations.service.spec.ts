import { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { WebhookIntegrationsService } from '../../../src/modules/integrations/webhooks/webhook-integrations.service.js';
import {
  WebhookGroupInvalidError,
  WebhookGroupNotFoundError,
  WebhookInstanceUnavailableError,
} from '../../../src/modules/integrations/webhooks/webhooks.errors.js';
import { hashWebhookSecret } from '../../../src/modules/integrations/webhooks/webhook-secret.js';
import type { EvolutionClient } from '../../../src/modules/whatsapp/evolution/evolution.client.js';

const tenant = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

const connectedInstance = {
  id: 'instance-1',
  name: 'Atendimento',
  instanceName: 'inst-1',
  status: 'CONNECTED',
  active: true,
};

function storedIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-1',
    tenantId: 'tenant-1',
    name: 'Integração',
    whatsappInstanceId: 'instance-1',
    groupJid: '120363000000000000@g.us',
    groupName: 'Grupo Teste',
    secretHash: hashWebhookSecret('whk_secret'),
    secretHint: 'cret',
    active: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    instance: connectedInstance,
    ...overrides,
  };
}

function createHarness() {
  const prisma = {
    webhookIntegration: {
      create: vi.fn().mockResolvedValue(storedIntegration()),
      update: vi.fn().mockResolvedValue(storedIntegration()),
      findFirst: vi.fn().mockResolvedValue(storedIntegration()),
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([storedIntegration()]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    whatsAppInstance: {
      findFirst: vi.fn().mockResolvedValue(connectedInstance),
    },
    $transaction: vi.fn().mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  const evolution = {
    findGroupInfos: vi.fn().mockResolvedValue({
      groupJid: '120363000000000000@g.us',
      subject: 'Grupo Teste',
      pictureUrl: null,
      size: 3,
    }),
    findGroups: vi.fn().mockResolvedValue([
      { groupJid: '120363000000000000@g.us', subject: 'Grupo Teste', pictureUrl: null, size: 3 },
    ]),
  };
  const tenantContext = new TenantContextService();

  const service = new WebhookIntegrationsService(
    prisma as unknown as PrismaService,
    tenantContext,
    evolution as unknown as EvolutionClient,
  );

  return { service, prisma, evolution, tenantContext };
}

function run<T>(tenantContext: TenantContextService, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ tenant }, fn);
}

describe('WebhookIntegrationsService', () => {
  it('creates an integration with a generated secret that is returned only once', async () => {
    const { service, prisma, evolution, tenantContext } = createHarness();

    const created = await run(tenantContext, () =>
      service.create({
        name: 'Integração',
        whatsappInstanceId: 'instance-1',
        groupJid: '120363000000000000@g.us',
        active: true,
      }),
    );

    expect(evolution.findGroupInfos).toHaveBeenCalledWith(
      'inst-1',
      '120363000000000000@g.us',
    );
    const createData = prisma.webhookIntegration.create.mock.calls[0][0].data;
    expect(createData.secretHash).toBe(hashWebhookSecret(created.secret));
    expect(createData.secretHint).toBe(created.secret.slice(-4));
    expect(created.secret).toMatch(/^whk_/);

    const listed = await run(tenantContext, () => service.list({ page: 1, perPage: 20, order: 'desc' }));
    expect(listed.data[0]).not.toHaveProperty('secret');
    expect(listed.data[0]).not.toHaveProperty('secretHash');
    expect(listed.data[0].secretHint).toBe('cret');
  });

  it('rejects an instance that is not connected', async () => {
    const { service, prisma, tenantContext } = createHarness();
    prisma.whatsAppInstance.findFirst.mockResolvedValue({
      ...connectedInstance,
      status: 'DISCONNECTED',
    });

    await expect(
      run(tenantContext, () =>
        service.create({
          name: 'Integração',
          whatsappInstanceId: 'instance-1',
          groupJid: '120363000000000000@g.us',
        }),
      ),
    ).rejects.toBeInstanceOf(WebhookInstanceUnavailableError);
  });

  it('rejects a destination that is not a group JID', async () => {
    const { service, evolution, tenantContext } = createHarness();

    await expect(
      run(tenantContext, () =>
        service.create({
          name: 'Integração',
          whatsappInstanceId: 'instance-1',
          groupJid: '5511999999999@s.whatsapp.net',
        }),
      ),
    ).rejects.toBeInstanceOf(WebhookGroupInvalidError);
    expect(evolution.findGroupInfos).not.toHaveBeenCalled();
  });

  it('rejects a group that does not belong to the instance', async () => {
    const { service, evolution, tenantContext } = createHarness();
    evolution.findGroupInfos.mockResolvedValue(null);

    await expect(
      run(tenantContext, () =>
        service.create({
          name: 'Integração',
          whatsappInstanceId: 'instance-1',
          groupJid: '120363000000000000@g.us',
        }),
      ),
    ).rejects.toBeInstanceOf(WebhookGroupNotFoundError);
  });

  it('lists groups through the existing Evolution client', async () => {
    const { service, evolution, tenantContext } = createHarness();

    const groups = await run(tenantContext, () => service.listGroups('instance-1'));

    expect(evolution.findGroups).toHaveBeenCalledWith('inst-1');
    expect(groups).toEqual([
      { jid: '120363000000000000@g.us', name: 'Grupo Teste', size: 3 },
    ]);
  });

  it('regenerates the credential and returns the new secret once', async () => {
    const { service, prisma, tenantContext } = createHarness();

    const regenerated = await run(tenantContext, () => service.regenerateSecret('webhook-1'));

    expect(regenerated.secret).toMatch(/^whk_/);
    const data = prisma.webhookIntegration.update.mock.calls[0][0].data;
    expect(data.secretHash).toBe(hashWebhookSecret(regenerated.secret));
  });

  it('logically deletes an integration scoped by tenant', async () => {
    const { service, prisma, tenantContext } = createHarness();

    await run(tenantContext, () => service.remove('webhook-1'));

    expect(prisma.webhookIntegration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'webhook-1', tenantId: 'tenant-1', deletedAt: null },
        data: expect.objectContaining({ active: false, deletedAt: expect.any(Date) }),
      }),
    );
  });
});
