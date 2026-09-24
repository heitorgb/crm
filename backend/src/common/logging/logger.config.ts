import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.validation.js';
import type { TenantContextService } from '../tenant-context/tenant-context.service.js';
import { normalizeRequestId } from './request-id.js';

interface LoggedRequest {
  method?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function stripQueryString(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }
  const separator = url.indexOf('?');
  return separator === -1 ? url : url.slice(0, separator);
}

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-webhook-secret"]',
  'req.headers.apikey',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.credentials',
  'body.password',
  'body.refreshToken',
  'body.credentials',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
  '*.apiKey',
  '*.secret',
  '*.webhookSecret',
  '*.credentials',
  '*.credentialsEncrypted',
  '*.accessKey',
  '*.secretKey',
  '*.authorization',
];

export function buildLoggerOptions(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  tenantContext: TenantContextService,
): Params['pinoHttp'] {
  return {
    level: env.LOG_LEVEL,
    genReqId: (request: IncomingMessage) => normalizeRequestId(request.headers['x-request-id']),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      req(request: LoggedRequest) {
        return {
          method: request.method,
          url: stripQueryString(request.url),
          remoteAddress: request.ip ?? request.socket?.remoteAddress,
        };
      },
    },
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
