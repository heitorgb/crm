import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { CreateMemberDto, UpdateMemberDto } from './dto/member.dto.js';
import { MembershipsService } from './memberships.service.js';

@Controller('members')
export class MembersController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  list() {
    return this.memberships.listMembersWithUsers();
  }

  @Get(':id/avatar')
  async avatar(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.memberships.readAvatar(id);

    reply.header('Content-Type', file.mimeType);
    reply.header('Cache-Control', 'private, max-age=3600');
    await reply.send(file.buffer);
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  create(@Body() dto: CreateMemberDto) {
    return this.memberships.createMember(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.memberships.updateMember(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.memberships.removeMember(id);
  }
}
