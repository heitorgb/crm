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
  Put,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { CustomMenuService } from './custom-menu.service.js';
import {
  CreateCustomMenuButtonDto,
  CreateCustomMenuGroupDto,
  SaveCustomMenuDto,
  UpdateCustomMenuButtonDto,
  UpdateCustomMenuGroupDto,
} from './dto/custom-menu.dto.js';

@Controller('custom-menu')
export class CustomMenuController {
  constructor(private readonly customMenu: CustomMenuService) {}

  @Get()
  list() {
    return this.customMenu.list();
  }

  @Get('navigation')
  navigation() {
    return this.customMenu.navigation();
  }

  @Roles('OWNER', 'ADMIN')
  @Put()
  save(@Body() dto: SaveCustomMenuDto) {
    return this.customMenu.save(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('groups')
  createGroup(@Body() dto: CreateCustomMenuGroupDto) {
    return this.customMenu.createGroup(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('groups/:id')
  updateGroup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomMenuGroupDto) {
    return this.customMenu.updateGroup(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('groups/:id')
  @HttpCode(204)
  async removeGroup(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.customMenu.removeGroup(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('groups/:id/buttons')
  createButton(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCustomMenuButtonDto) {
    return this.customMenu.createButton(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('buttons/:id')
  updateButton(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomMenuButtonDto) {
    return this.customMenu.updateButton(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('buttons/:id')
  @HttpCode(204)
  async removeButton(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.customMenu.removeButton(id);
  }
}
