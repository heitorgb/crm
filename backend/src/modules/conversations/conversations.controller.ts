import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  PaginationQueryDto,
  DEFAULT_PAGE,
  DEFAULT_PER_PAGE,
} from '../../common/http/pagination.js';
import { ConversationsService } from './conversations.service.js';
import { MessagesService } from './messages.service.js';
import {
  CreateConversationDto,
  ListConversationsQueryDto,
  SendConversationMessageDto,
  UpdateConversationDto,
} from './dto/conversation.dto.js';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  @Get()
  list(@Query() query: ListConversationsQueryDto) {
    return this.conversations.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversations.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationDto) {
    return this.conversations.update(id, dto);
  }

  @Post(':id/takeover')
  @HttpCode(200)
  takeover(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.takeover(id);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.close(id);
  }

  @Get(':id/messages')
  listMessages(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.messages.listByConversation(
      id,
      query.page ?? DEFAULT_PAGE,
      query.perPage ?? DEFAULT_PER_PAGE,
    );
  }

  @Post(':id/messages')
  @HttpCode(201)
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendConversationMessageDto,
  ): Promise<{ ok: true }> {
    await this.conversations.sendHumanMessage(id, dto.content.trim());
    return { ok: true };
  }
}
