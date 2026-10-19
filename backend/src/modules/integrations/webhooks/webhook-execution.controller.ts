import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RateLimit } from '../../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../../common/http/rate-limit/rate-limit.guard.js';
import { Public } from '../../auth/decorators/auth.decorators.js';
import { ExecuteWebhookDto } from './dto/webhook.dto.js';
import { WebhookExecutionService } from './webhook-execution.service.js';
import { extractWebhookSecret } from './webhook-secret.js';
import { WebhookMessageRequiredError } from './webhooks.errors.js';

@Controller('integrations/webhooks')
export class WebhookExecutionController {
  constructor(private readonly executions: WebhookExecutionService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'integration-webhook-execute', limit: 120, windowMs: 60_000 })
  @Post(':id/execute')
  @HttpCode(200)
  async execute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecuteWebhookDto,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-webhook-secret') secretHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    if (dto.message.trim().length === 0) {
      throw new WebhookMessageRequiredError();
    }

    return this.executions.execute({
      webhookId: id,
      secret: extractWebhookSecret(authorization, secretHeader),
      message: dto.message,
      idempotencyKey,
      ip: request.ip,
    });
  }
}
