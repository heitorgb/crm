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
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from '../../common/errors/app.exception.js';
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

  @Post(':id/messages/media')
  @HttpCode(201)
  async sendMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ ok: true }> {
    if (!request.isMultipart()) {
      throw new AppException('MEDIA_REQUIRED', 'A multipart file upload is required', 400);
    }

    const file = await request.file();
    if (!file) {
      throw new AppException('MEDIA_REQUIRED', 'No file was uploaded', 400);
    }

    const buffer = await file.toBuffer();
    const caption = readCaption(file.fields);

    await this.conversations.sendHumanMedia(id, {
      buffer,
      mimeType: file.mimetype,
      fileName: file.filename || 'file',
      caption,
    });

    return { ok: true };
  }

  @Get(':id/messages/:messageId/attachments/:attachmentId')
  async downloadAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Query('variant') variant: string | undefined,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.messages.readAttachment({
      conversationId: id,
      messageId,
      attachmentId,
      variant: variant === 'thumb' ? 'thumb' : 'main',
    });

    reply.header('Content-Type', file.mimeType);
    reply.header('Cache-Control', 'private, max-age=3600');
    if (download === '1') {
      reply.header('Content-Disposition', `attachment; filename="${sanitizeFileName(file.fileName)}"`);
    }

    await reply.send(file.buffer);
  }
}

function readCaption(fields: unknown): string | undefined {
  if (typeof fields !== 'object' || fields === null) {
    return undefined;
  }
  const caption = (fields as Record<string, unknown>).caption;
  if (
    typeof caption === 'object' &&
    caption !== null &&
    'value' in caption &&
    typeof (caption as { value?: unknown }).value === 'string'
  ) {
    const value = (caption as { value: string }).value.trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/["\r\n]/g, '_');
}
