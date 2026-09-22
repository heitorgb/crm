import { Module } from '@nestjs/common';
import { MembersController } from './members.controller.js';
import { MembershipsService } from './memberships.service.js';

@Module({
  controllers: [MembersController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
