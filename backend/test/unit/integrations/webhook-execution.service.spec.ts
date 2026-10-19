import type { RateLimitService } from '../../../src/common/http/rate-limit/rate-limit.service.js';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { ConversationProcessingService } from '../../../src/modules/conversations/conversation-processing.service.js';
import { ModuleDisabledError } from '../../../src/modules/modules/modules.errors.js';
import type { ModulesService } from '../../../src/modules/modules/modules.service.js';
import { WebhookExecutionService } from '../../../src/modules/integrations/webhooks/webhook-execution.service.js';
import { hashWebhookSecret } from '../../../src/modules/integrations/webhooks/webhook-secret.js';
import {
  RateLimitedError,
} from '../../../src/common/http/rate-limit/rate-limit.guard.js';
import {
  WebhookExecutionFailedError,
  WebhookGroupInvalidError,
  WebhookInstanceUnavailableError,
  WebhookIntegrationInactiveError,
  WebhookProviderError,
  WebhookUnauthorizedError,
} from '../../../src/modules/integrations/webhooks/webhooks.errors.js';
import { EvolutionRequestError } from '../../../src/modules/whatsapp/evolution/evolution.client.js';

const SECRET = 'whk_super-secret';

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-1',
    tenantId: 'tenant-1',
    name: 'Integração',
    whatsappInstanceId: 'instance-1',
    groupJid: '120363000000000000@g.us',
    groupName: 'Grupo Teste',
    secretHash: hashWebhookSecret(SECRET),
    secretHint: 'cret',
    active: true,
    deletedAt: null,
    instance: {
      id: 'instance-1',
      instanceName: 'inst-1',
      status: 'CONNECTED',
      active: true,
    },
    ...overrides,
  };
}

function createHarness() {
  const prisma = {
    webhookIntegration: { findFirst: vi.fn().mockResolvedValue(integration()) },
    webhookExecution: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'execution-1' }),
      update: vi.fn().mockImplementation(({ data }) => ({
        id: 'execution-1',
        status: data.status,
        externalMessageId: data.externalMessageId ?? null,
        messageId: data.messageId ?? null,
        conversationId: data.conversationId ?? null,
      })),
    },
  };
  const modules = { isEnabled: vi.fn().mockResolvedValue(true) };
  const limiter = { hit: vi.fn().mockReturnValue(true) };
  const evolution = {
    sendText: vi.fn().mockResolvedValue({ externalMessageId: 'ext-1', raw: {} }),
  };
  const conversations = {
    recordOutboundMessage: vi.fn().mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
    }),
  };

  const service = new WebhookExecutionService(
    prisma as unknown as PrismaService,
    {} as unknown as TenantContextService,
    modules as unknown as ModulesService,
    limiter as unknown as RateLimitService,
    evolution as never,
    conversations as unknown as ConversationProcessingService,
  );

  return { service, prisma, modules, limiter, evolution, conversations };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    webhookId: 'webhook-1',
    secret: SECRET,
    message: 'Olá, grupo!',
    idempotencyKey: null,
    ip: '127.0.0.1',
    ...overrides,
  };
}

describe('WebhookExecutionService', () => {
  it('sends to the configured group and records the message and execution', async () => {
    const { service, evolution, conversations, prisma } = createHarness();

    const result = await service.execute(input());

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '120363000000000000@g.us',
      'Olá, grupo!',
    );
    expect(conversations.recordOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        whatsappInstanceId: 'instance-1',
        externalContactId: '120363000000000000@g.us',
        externalMessageId: 'ext-1',
        isGroup: true,
        groupName: 'Grupo Teste',
      }),
    );
    expect(prisma.webhookExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'execution-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          externalMessageId: 'ext-1',
          messageId: 'message-1',
          conversationId: 'conversation-1',
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      executionId: 'execution-1',
      status: 'SUCCESS',
      externalMessageId: 'ext-1',
      messageId: 'message-1',
      conversationId: 'conversation-1',
    });
  });

  it('rejects an invalid credential before sending', async () => {
    const { service, evolution } = createHarness();

    await expect(service.execute(input({ secret: 'wrong' }))).rejects.toBeInstanceOf(
      WebhookUnauthorizedError,
    );
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('rejects an inactive integration', async () => {
    const { service, prisma, evolution } = createHarness();
    prisma.webhookIntegration.findFirst.mockResolvedValue(integration({ active: false }));

    await expect(service.execute(input())).rejects.toBeInstanceOf(
      WebhookIntegrationInactiveError,
    );
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('rejects execution when the webhooks module is disabled', async () => {
    const { service, modules, evolution } = createHarness();
    modules.isEnabled.mockResolvedValue(false);

    await expect(service.execute(input())).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('rejects an inactive or disconnected instance', async () => {
    const { service, prisma, evolution } = createHarness();
    prisma.webhookIntegration.findFirst.mockResolvedValue(
      integration({
        instance: {
          id: 'instance-1',
          instanceName: 'inst-1',
          status: 'DISCONNECTED',
          active: true,
        },
      }),
    );

    await expect(service.execute(input())).rejects.toBeInstanceOf(
      WebhookInstanceUnavailableError,
    );
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('rejects a stored destination that is not a group', async () => {
    const { service, prisma, evolution } = createHarness();
    prisma.webhookIntegration.findFirst.mockResolvedValue(
      integration({ groupJid: '5511999999999@s.whatsapp.net' }),
    );

    await expect(service.execute(input())).rejects.toBeInstanceOf(WebhookGroupInvalidError);
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('applies the per-integration rate limit', async () => {
    const { service, limiter, evolution } = createHarness();
    limiter.hit.mockReturnValue(false);

    await expect(service.execute(input())).rejects.toBeInstanceOf(RateLimitedError);
    expect(limiter.hit).toHaveBeenCalledWith(
      'webhook-integration:webhook-1:127.0.0.1',
      60,
      60_000,
    );
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('records a sanitized failure when Evolution rejects the send', async () => {
    const { service, evolution, conversations, prisma } = createHarness();
    evolution.sendText.mockRejectedValue(new EvolutionRequestError('provider exploded', 500));

    await expect(service.execute(input())).rejects.toBeInstanceOf(WebhookProviderError);

    expect(conversations.recordOutboundMessage).not.toHaveBeenCalled();
    expect(prisma.webhookExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorCode: 'EVOLUTION_HTTP_500',
        }),
      }),
    );
  });

  it('replays a successful execution with the same idempotency key without sending again', async () => {
    const { service, prisma, evolution } = createHarness();
    prisma.webhookExecution.findUnique.mockResolvedValue({
      id: 'execution-old',
      status: 'SUCCESS',
      externalMessageId: 'ext-old',
      messageId: 'message-old',
      conversationId: 'conversation-old',
    });

    const result = await service.execute(input({ idempotencyKey: 'order-123' }));

    expect(result).toMatchObject({ executionId: 'execution-old', externalMessageId: 'ext-old' });
    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(prisma.webhookExecution.create).not.toHaveBeenCalled();
  });

  it('does not resend a failed execution with the same idempotency key', async () => {
    const { service, prisma, evolution } = createHarness();
    prisma.webhookExecution.findUnique.mockResolvedValue({
      id: 'execution-old',
      status: 'FAILED',
      externalMessageId: null,
      messageId: null,
      conversationId: null,
    });

    await expect(service.execute(input({ idempotencyKey: 'order-456' }))).rejects.toBeInstanceOf(
      WebhookExecutionFailedError,
    );
    expect(evolution.sendText).not.toHaveBeenCalled();
  });
});
