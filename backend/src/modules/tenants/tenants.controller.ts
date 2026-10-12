import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { UpdateTenantDto } from './dto/tenant.dto.js';
import { TenantsService } from './tenants.service.js';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('current')
  getCurrent() {
    return this.tenants.getCurrent();
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('current')
  rename(@Body() dto: UpdateTenantDto) {
    return this.tenants.rename(dto);
  }
}
