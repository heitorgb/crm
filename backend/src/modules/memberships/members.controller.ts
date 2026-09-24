import { Controller, Get } from '@nestjs/common';
import { MembershipsService } from './memberships.service.js';

@Controller('members')
export class MembersController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  list() {
    return this.memberships.listMembersWithUsers();
  }
}
