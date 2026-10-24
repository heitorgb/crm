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
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { ListScheduledMessagesQueryDto } from './dto/scheduled-message.dto.js';
import {
  ScheduledMessagesService,
  type ScheduledMessageAttachmentFile,
} from './scheduled-messages.service.js';

interface ParsedMultipart {
  fields: Record<string, string>;
  file: ScheduledMessageAttachmentFile | null;
}

@Controller('scheduled-messages')
@RequireModule(MODULE_KEYS.ATTENDANCE)
export class ScheduledMessagesController {
  constructor(
    private readonly scheduledMessages: ScheduledMessagesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  list(@Query() query: ListScheduledMessagesQueryDto) {
    return this.scheduledMessages.list({
      page: query.page,
      perPage: query.perPage,
      search: query.search,
      status: query.status,
      type: query.type,
      order: query.order,
    });
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  @HttpCode(201)
  async create(@Req() request: FastifyRequest) {
    const parsed = await parseMultipart(request);
    const { tenantId, userId } = this.tenantContext.requireContext();

    return this.scheduledMessages.create({
      tenantId,
      createdByUserId: userId,
      type: parsed.fields.type ?? '',
      title: parsed.fields.title ?? '',
      content: parsed.fields.content ?? '',
      valor: parsed.fields.valor ?? null,
      recurrence: parsed.fields.recurrence ?? 'ONCE',
      weekdays: parseWeekdaysField(parsed.fields.weekdays),
      scheduledAt: parsed.fields.scheduledAt ?? '',
      conversationIds: parseConversationIds(parsed.fields.recipientConversationIds),
      file: parsed.file,
    });
  }

  @Get(':id/logs')
  logs(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduledMessages.logs(id);
  }

  @Get(':id/recipients')
  recipients(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduledMessages.listRecipients(id);
  }

  @Get(':id/attachment')
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.scheduledMessages.readAttachment(id);
    reply.header('Content-Type', file.mimeType);
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.header('Content-Disposition', `inline; filename="${sanitizeFileName(file.fileName)}"`);
    await reply.send(file.buffer);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduledMessages.findOne(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    const parsed = await parseMultipart(request);
    return this.scheduledMessages.update(id, {
      type: parsed.fields.type,
      title: parsed.fields.title,
      content: parsed.fields.content,
      valor: parsed.fields.valor,
      recurrence: parsed.fields.recurrence,
      weekdays: parseWeekdaysField(parsed.fields.weekdays),
      scheduledAt: parsed.fields.scheduledAt,
      conversationIds:
        parsed.fields.recipientConversationIds !== undefined
          ? parseConversationIds(parsed.fields.recipientConversationIds)
          : undefined,
      file: parsed.file,
      removeAttachment: parsed.fields.removeAttachment === 'true',
    });
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduledMessages.cancel(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/duplicate')
  @HttpCode(201)
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scheduledAt?: string } | undefined,
  ) {
    return this.scheduledMessages.duplicate(id, body?.scheduledAt);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/retry')
  @HttpCode(202)
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scheduledFor?: string } | undefined,
  ) {
    return this.scheduledMessages.retry(id, body?.scheduledFor);
  }
}

async function parseMultipart(request: FastifyRequest): Promise<ParsedMultipart> {
  if (!request.isMultipart()) {
    throw new AppException(
      'SCHEDULED_MESSAGE_MULTIPART_REQUIRED',
      'Envie o agendamento como multipart/form-data.',
      400,
    );
  }

  const fields: Record<string, string> = {};
  let file: ScheduledMessageAttachmentFile | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch (error) {
        if (isFileTooLargeError(error)) {
          throw new AppException(
            'SCHEDULED_MESSAGE_ATTACHMENT_TOO_LARGE',
            'Arquivo maior que o permitido.',
            413,
          );
        }
        throw error;
      }
      file = {
        buffer,
        fileName: part.filename || 'anexo',
        mimeType: part.mimetype,
      };
      continue;
    }
    fields[part.fieldname] = String(part.value ?? '');
  }

  return { fields, file };
}

function parseConversationIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppException(
      'SCHEDULED_MESSAGE_INVALID_RECIPIENTS',
      'Formato de destinatários inválido.',
      400,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new AppException(
      'SCHEDULED_MESSAGE_INVALID_RECIPIENTS',
      'Formato de destinatários inválido.',
      400,
    );
  }
  return [...new Set(parsed.filter((item): item is string => typeof item === 'string'))];
}

function parseWeekdaysField(value: string | undefined): unknown {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/["\r\n]/g, '_');
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
