import { Injectable, NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeRequestId } from '../logging/request-id.js';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const requestId = normalizeRequestId(request.id);
    response.setHeader('x-request-id', requestId);
    this.tenantContext.run({ requestId }, next);
  }
}
