import type { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import type { Env } from '../../../src/config/env.validation.js';
import type { WebhookService } from '../../../src/modules/webhooks/webhook.service.js';
import { WebhooksController } from '../../../src/modules/webhooks/webhooks.controller.js';
import { WebhookUnauthorizedError } from '../../../src/modules/webhooks/webhooks.errors.js';
import type { WhatsAppInstancesService } from '../../../src/modules/whatsapp/whatsapp-instances.service.js';

interface Harness {
  controller: WebhooksController;
  webhooks: { ingestEvolution: ReturnType<typeof vi.fn> };
  instances: { resolveWebhookSecretForInstanceName: ReturnType<typeof vi.fn> };
}

function createHarness(env: Record<string, string | undefined>): Harness {
  const webhooks = { ingestEvolution: vi.fn().mockResolvedValue({ accepted: true }) };
  const instances = { resolveWebhookSecretForInstanceName: vi.fn().mockResolvedValue(null) };
  const config = { get: vi.fn((key: string) => env[key]) };

  const controller = new WebhooksController(
    webhooks as unknown as WebhookService,
    instances as unknown as WhatsAppInstancesService,
    config as unknown as ConfigService<Env, true>,
  );

  return { controller, webhooks, instances };
}

function request(
  body: Record<string, unknown>,
  headerSecret?: string,
): FastifyRequest {
  return {
    body,
    headers: headerSecret ? { 'x-webhook-secret': headerSecret } : {},
  } as unknown as FastifyRequest;
}

describe('WebhooksController secret validation', () => {
  it('accepts the global secret without querying instance credentials', async () => {
    const { controller, webhooks, instances } = createHarness({
      EVOLUTION_WEBHOOK_SECRET: 'global-secret',
    });

    await controller.evolution(request({ event: 'messages.upsert', instance: 'inst-1' }), 'global-secret');

    expect(instances.resolveWebhookSecretForInstanceName).not.toHaveBeenCalled();
    expect(webhooks.ingestEvolution).toHaveBeenCalled();
  });

  it('accepts an instance-specific secret when it differs from the global one', async () => {
    const { controller, webhooks, instances } = createHarness({
      EVOLUTION_WEBHOOK_SECRET: 'global-secret',
    });
    instances.resolveWebhookSecretForInstanceName.mockResolvedValue('instance-secret');

    await controller.evolution(
      request({ event: 'messages.upsert', instance: 'inst-1' }),
      'instance-secret',
    );

    expect(instances.resolveWebhookSecretForInstanceName).toHaveBeenCalledWith('inst-1');
    expect(webhooks.ingestEvolution).toHaveBeenCalled();
  });

  it('accepts the secret sent in the x-webhook-secret header', async () => {
    const { controller, webhooks } = createHarness({ EVOLUTION_WEBHOOK_SECRET: 'global-secret' });

    await controller.evolution(
      request({ event: 'messages.upsert', instance: 'inst-1' }, 'global-secret'),
      undefined,
    );

    expect(webhooks.ingestEvolution).toHaveBeenCalled();
  });

  it('rejects when neither the global nor the instance secret matches', async () => {
    const { controller, webhooks, instances } = createHarness({
      EVOLUTION_WEBHOOK_SECRET: 'global-secret',
    });
    instances.resolveWebhookSecretForInstanceName.mockResolvedValue('instance-secret');

    await expect(
      controller.evolution(request({ event: 'messages.upsert', instance: 'inst-1' }), 'wrong'),
    ).rejects.toBeInstanceOf(WebhookUnauthorizedError);
    expect(webhooks.ingestEvolution).not.toHaveBeenCalled();
  });

  it('rejects unknown instances that do not present the global secret', async () => {
    const { controller } = createHarness({ EVOLUTION_WEBHOOK_SECRET: 'global-secret' });

    await expect(
      controller.evolution(request({ event: 'messages.upsert', instance: 'ghost' }), 'wrong'),
    ).rejects.toBeInstanceOf(WebhookUnauthorizedError);
  });

  it('rejects requests without any token', async () => {
    const { controller } = createHarness({ EVOLUTION_WEBHOOK_SECRET: 'global-secret' });

    await expect(
      controller.evolution(request({ event: 'messages.upsert', instance: 'inst-1' }), undefined),
    ).rejects.toBeInstanceOf(WebhookUnauthorizedError);
  });
});
