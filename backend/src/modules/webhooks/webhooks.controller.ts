import { Controller, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import type { Env } from '../../config/env.validation.js';
import { Public } from '../auth/decorators/auth.decorators.js';
import { WebhookService } from './webhook.service.js';
import { WebhookUnauthorizedError } from './webhooks.errors.js';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhookService,
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
    this.assertSecret(request, token);
    return this.webhooks.ingestEvolution(request.body);
  }

  private assertSecret(request: FastifyRequest, token?: string): void {
    const expected = this.config.get('EVOLUTION_WEBHOOK_SECRET');
    if (!expected) {
      return;
    }

    const header = request.headers['x-webhook-secret'];
    const provided = token ?? (typeof header === 'string' ? header : undefined);

    if (!provided || !safeEqual(provided, expected)) {
      throw new WebhookUnauthorizedError();
    }
  }
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
