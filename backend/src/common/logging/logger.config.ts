import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.validation.js';
import type { TenantContextService } from '../tenant-context/tenant-context.service.js';
import { normalizeRequestId } from './request-id.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
];

export function buildLoggerOptions(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  tenantContext: TenantContextService,
): Params['pinoHttp'] {
  return {
    level: env.LOG_LEVEL,
    genReqId: (request: IncomingMessage) => normalizeRequestId(request.headers['x-request-id']),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    customProps: () => {
      const context = tenantContext.getContext();
      return {
        requestId: tenantContext.getRequestId(),
        tenantId: context?.tenantId,
        userId: context?.userId,
      };
    },
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:standard' },
          }
        : undefined,
  };
}
