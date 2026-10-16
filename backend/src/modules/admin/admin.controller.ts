import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import {
  AddMemberDto,
  CreateTenantDto,
  ListTenantsQueryDto,
  ListUsersQueryDto,
  UpdateMemberDto,
  UpdateTenantModuleDto,
} from './dto/admin.dto.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator.js';
import { ModulesService } from '../modules/modules.service.js';

@Controller('admin')
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly modules: ModulesService,
  ) {}

  @Get('tenants')
  listTenants(@Query() query: ListTenantsQueryDto) {
    return this.admin.listTenants(query);
  }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.admin.createTenantWithOwner(dto);
  }

  @Get('tenants/:id')
  getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getTenant(id);
  }

  @Get('modules')
  listModules() {
    return this.modules.listCatalog();
  }

  @Get('tenants/:id/modules')
  listTenantModules(@Param('id', ParseUUIDPipe) id: string) {
    return this.modules.listForTenant(id);
  }

  @Patch('tenants/:id/modules/:moduleKey')
  updateTenantModule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: UpdateTenantModuleDto,
    @CurrentTenant() context: TenantContext,
  ) {
    return this.modules.setModuleEnabledForTenant({
      tenantId: id,
      moduleKey,
      enabled: dto.enabled,
      actorUserId: context.userId,
    });
  }

  @Post('tenants/:id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.admin.addMember(id, dto);
  }

  @Patch('tenants/:id/members/:membershipId')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.admin.updateMember(id, membershipId, dto);
  }

  @Delete('tenants/:id/members/:membershipId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.admin.removeMember(id, membershipId);
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(query);
  }
}
