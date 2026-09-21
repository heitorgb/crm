import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { TenantContextService } from '../../../common/tenant-context/tenant-context.service.js';
import { ROLES_KEY } from '../auth.constants.js';
import { ForbiddenRoleError, InvalidAccessTokenError } from '../auth.errors.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const tenant = this.tenantContext.getContext();

    if (!tenant) {
      throw new InvalidAccessTokenError();
    }

    if (!requiredRoles.includes(tenant.role as Role)) {
      throw new ForbiddenRoleError();
    }

    return true;
  }
}
