import { Controller, Get } from '@nestjs/common';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator.js';
import { ModulesService } from './modules.service.js';

@Controller('modules')
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get('enabled')
  async enabled(@CurrentTenant() context: TenantContext): Promise<{ modules: string[] }> {
    const modules = await this.modules.listEnabledKeys(context.tenantId);
    return { modules };
  }
}
