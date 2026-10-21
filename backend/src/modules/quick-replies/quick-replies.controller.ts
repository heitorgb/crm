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
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import {
  CreateQuickReplyDto,
  ListQuickRepliesQueryDto,
  UpdateQuickReplyDto,
} from './dto/quick-reply.dto.js';
import { QuickRepliesService } from './quick-replies.service.js';

@Controller('quick-replies')
@RequireModule(MODULE_KEYS.ATTENDANCE)
export class QuickRepliesController {
  constructor(private readonly quickReplies: QuickRepliesService) {}

  @Get()
  list(@Query() query: ListQuickRepliesQueryDto) {
    return this.quickReplies.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.quickReplies.findOne(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  create(@Body() dto: CreateQuickReplyDto) {
    return this.quickReplies.create(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuickReplyDto) {
    return this.quickReplies.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.quickReplies.remove(id);
  }
}
