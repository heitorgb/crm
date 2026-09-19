import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(request: FastifyRequest, _response: unknown, next: () => void): void {
    const requestId = request.id || randomUUID();
    this.tenantContext.run({ requestId }, next);
  }
}
