import type { Role } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: Role;
}

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: TenantContext;
}

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  user: PublicUser;
  tenant: { id: string; name: string };
  role: Role;
  membershipId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return undefined;
  }

  return value.trim() || undefined;
}
