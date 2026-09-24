import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { FastifyServerOptions, RawRequestDefaultExpression } from 'fastify';
import { normalizeRequestId } from '../logging/request-id.js';

const BODY_LIMIT_BYTES = 1_048_576;

export function createFastifyAdapter(options: FastifyServerOptions = {}): FastifyAdapter {
  return new FastifyAdapter({
    trustProxy: true,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (request: RawRequestDefaultExpression) =>
      normalizeRequestId(request.headers['x-request-id']),
    ...options,
  });
}
