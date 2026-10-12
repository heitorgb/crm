import { Module } from '@nestjs/common';
import { PasswordModule } from '../auth/password.module.js';
import { MembersController } from './members.controller.js';
import { MembershipsService } from './memberships.service.js';

@Module({
  imports: [PasswordModule],
  controllers: [MembersController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
