import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { InvalidAccessTokenError } from '../auth/auth.errors.js';
import { REQUIRED_MODULE_KEY } from './modules.constants.js';
import { ModuleDisabledError } from './modules.errors.js';
import { ModulesService } from './modules.service.js';

/**
 * Enforces per-organization module availability on every handler annotated with
 * `@RequireModule(...)`. Runs after the global JwtAuthGuard, so the tenant is
 * always derived from the verified token and membership, never from the request.
 */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
    private readonly modules: ModulesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!moduleKey) {
      return true;
    }

    const tenant = this.tenantContext.getContext();
    if (!tenant) {
      throw new InvalidAccessTokenError();
    }

    const enabled = await this.modules.isEnabled(tenant.tenantId, moduleKey);
    if (!enabled) {
      throw new ModuleDisabledError(moduleKey);
    }

    return true;
  }
}
