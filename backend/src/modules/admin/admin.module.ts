import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ModulesModule } from '../modules/modules.module.js';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

@Module({
  imports: [AuthModule, ModulesModule, PlatformSettingsModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
