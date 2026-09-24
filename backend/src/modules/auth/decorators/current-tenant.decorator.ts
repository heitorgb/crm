import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '../../../common/tenant-context/tenant-context.types.js';
import type { AuthenticatedRequest } from '../auth.types.js';
import { InvalidAccessTokenError } from '../auth.errors.js';

export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext): TenantContext => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const tenant = request.auth;

  if (!tenant) {
    throw new InvalidAccessTokenError();
  }

  return tenant;
});
