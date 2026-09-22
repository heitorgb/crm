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
  CreateWhatsAppInstanceDto,
  ListWhatsAppInstancesQueryDto,
  UpdateWhatsAppInstanceDto,
} from './dto/whatsapp-instance.dto.js';
import { WhatsAppInstancesService } from './whatsapp-instances.service.js';

@Controller('whatsapp/instances')
export class WhatsAppInstancesController {
  constructor(private readonly instances: WhatsAppInstancesService) {}

  @Get()
  list(@Query() query: ListWhatsAppInstancesQueryDto) {
    return this.instances.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.instances.findOne(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  create(@Body() dto: CreateWhatsAppInstanceDto) {
    return this.instances.create(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWhatsAppInstanceDto) {
    return this.instances.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.instances.remove(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/connect')
  connect(@Param('id', ParseUUIDPipe) id: string) {
    return this.instances.connect(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/disconnect')
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    return this.instances.disconnect(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/webhook')
  configureWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.instances.configureWebhook(id);
  }

  @Get(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.instances.refreshStatus(id);
  }
}
