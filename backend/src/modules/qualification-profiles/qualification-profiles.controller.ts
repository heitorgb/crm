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
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorators.js';
import {
  CreateQualificationProfileDto,
  ListQualificationProfilesQueryDto,
  UpdateQualificationProfileDto,
} from './dto/qualification-profile.dto.js';
import { QualificationProfilesService } from './qualification-profiles.service.js';

@Controller('qualification-profiles')
export class QualificationProfilesController {
  constructor(private readonly profiles: QualificationProfilesService) {}

  @Get()
  list(@Query() query: ListQualificationProfilesQueryDto) {
    return this.profiles.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.findOne(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  create(@Body() dto: CreateQualificationProfileDto) {
    return this.profiles.create(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQualificationProfileDto) {
    return this.profiles.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.profiles.remove(id);
  }
}
