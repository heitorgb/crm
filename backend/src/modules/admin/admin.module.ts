import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
