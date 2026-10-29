import { Controller, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import type { Env } from '../../config/env.validation.js';
import { Public } from '../auth/decorators/auth.decorators.js';
import { WhatsAppInstancesService } from '../whatsapp/whatsapp-instances.service.js';
import { WebhookService, readInstanceName } from './webhook.service.js';
import { WebhookUnauthorizedError } from './webhooks.errors.js';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly instances: WhatsAppInstancesService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'webhook-evolution', limit: 300, windowMs: 60_000 })
  @Post('evolution')
  @HttpCode(200)
  async evolution(
    @Req() request: FastifyRequest,
    @Query('token') token?: string,
  ): Promise<unknown> {
    await this.assertSecret(request, token);
    return this.webhooks.ingestEvolution(request.body, {
      observedAt: providerObservedAt(request.headers['x-timestamp']),
    });
  }

  private async assertSecret(request: FastifyRequest, token?: string): Promise<void> {
    const header = request.headers['x-webhook-secret'];
    const provided = token ?? (typeof header === 'string' ? header : undefined);
    if (!provided) {
      throw new WebhookUnauthorizedError();
    }

    const globalSecret = this.config.get('EVOLUTION_WEBHOOK_SECRET');
    if (globalSecret && safeEqual(provided, globalSecret)) {
      return;
    }

    const body = request.body;
    const instanceName = isRecord(body) ? readInstanceName(body) : null;
    if (instanceName) {
      const instanceSecret = await this.instances.resolveWebhookSecretForInstanceName(instanceName);
      if (instanceSecret && safeEqual(provided, instanceSecret)) {
        return;
      }
    }

    throw new WebhookUnauthorizedError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Evolution 2.4 sends `X-Timestamp` (Date.now in ms) on every webhook. It is
 * the provider clock at dispatch and is used to order concurrently delivered
 * events; the payload's `date_time` is not used because 2.4 builds it with a
 * timezone offset. Values far from the local clock fall back to receipt time.
 */
function providerObservedAt(header: string | string[] | undefined): Date | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const now = Date.now();
  if (Math.abs(now - parsed) > 10 * 60_000) {
    return null;
  }
  return new Date(parsed);
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
