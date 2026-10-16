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
import { RequireModule } from '../modules/require-module.decorator.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import {
  CreateConversationDto,
  EditConversationMessageDto,
  ListConversationsQueryDto,
  SendConversationMessageDto,
  StartConversationDto,
  UpdateConversationDto,
} from './dto/conversation.dto.js';

@Controller('conversations')
@RequireModule(MODULE_KEYS.ATTENDANCE)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  @Get()
  list(@Query() query: ListConversationsQueryDto) {
    return this.conversations.list(query);
  }

  @Get('unread-count')
  unreadCount() {
    return this.conversations.unreadTotal();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversations.create(dto);
  }

  @Post('start')
  @HttpCode(200)
  startFromContact(@Body() dto: StartConversationDto) {
    return this.conversations.startFromContact(dto);
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

  @Post(':id/pin')
  @HttpCode(200)
  pin(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.pin(id);
  }

  @Post(':id/unpin')
  @HttpCode(200)
  unpin(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.unpin(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.archive(id);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.unarchive(id);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.markAsRead(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.conversations.softDelete(id);
  }

  @Post(':id/refresh-group')
  @HttpCode(200)
  refreshGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.refreshGroupMetadata(id);
  }

  @Get(':id/messages')
  listMessages(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.messages.listByConversation(
      id,
      query.page ?? DEFAULT_PAGE,
      query.perPage ?? DEFAULT_PER_PAGE,
    );
  }

  @Get(':id/participant-avatar')
  resolveParticipantAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('jid') jid: string | undefined,
  ) {
    if (!jid) {
      throw new AppException('JID_REQUIRED', 'O parâmetro jid é obrigatório.', 400);
    }
    return this.conversations.resolveParticipantAvatar(id, jid);
  }

  @Post(':id/messages')
  @HttpCode(201)
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendConversationMessageDto,
  ): Promise<{ ok: true }> {
    await this.conversations.sendHumanMessage(
      id,
      dto.content.trim(),
      dto.includeAgentName ?? false,
      dto.quotedMessageId ?? null,
    );
    return { ok: true };
  }

  @Patch(':id/messages/:messageId')
  @HttpCode(200)
  editMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditConversationMessageDto,
  ) {
    return this.conversations.editHumanMessage(id, messageId, dto.content);
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
      throw new AppException('MEDIA_REQUIRED', 'Nenhum arquivo foi enviado.', 400);
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if (isFileTooLargeError(error)) {
        throw new AppException('MEDIA_TOO_LARGE', 'Arquivo maior que o permitido.', 413);
      }
      throw error;
    }

    const caption = readCaption(file.fields);
    const includeAgentName = readBooleanField(file.fields, 'includeAgentName');
    const quotedMessageId = readStringField(file.fields, 'quotedMessageId');

    await this.conversations.sendHumanMedia(
      id,
      {
        buffer,
        mimeType: file.mimetype,
        fileName: file.filename || 'file',
        caption,
      },
      includeAgentName,
      quotedMessageId,
    );

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

function isFileTooLargeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: string; code?: string };
  return (
    candidate.name === 'RequestFileTooLargeError' || candidate.code === 'FST_REQ_FILE_TOO_LARGE'
  );
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

function readBooleanField(fields: unknown, key: string): boolean {
  return readStringField(fields, key) === 'true';
}

function readStringField(fields: unknown, key: string): string | null {
  if (typeof fields !== 'object' || fields === null) {
    return null;
  }
  const field = (fields as Record<string, unknown>)[key];
  if (
    typeof field === 'object' &&
    field !== null &&
    'value' in field &&
    typeof (field as { value?: unknown }).value === 'string'
  ) {
    const value = (field as { value: string }).value.trim();
    return value.length > 0 ? value : null;
  }
  return null;
}
