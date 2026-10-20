import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import {
  BulkMediaIdempotencyKeyRequiredError,
  BulkMediaInvalidRecipientsError,
} from './bulk-media.errors.js';
import { BulkMediaService } from './bulk-media.service.js';

@Controller('conversations/bulk-media')
@RequireModule(MODULE_KEYS.ATTENDANCE)
export class BulkMediaController {
  constructor(
    private readonly bulkMedia: BulkMediaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @HttpCode(202)
  async create(@Req() request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw new AppException(
        'BULK_MEDIA_FILE_REQUIRED',
        'Envie a foto como multipart/form-data.',
        400,
      );
    }

    const file = await request.file();
    if (!file) {
      throw new AppException('BULK_MEDIA_FILE_REQUIRED', 'Nenhuma foto foi enviada.', 400);
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

    const conversationIds = parseConversationIds(readStringField(file.fields, 'conversationIds'));
    const idempotencyKey = readStringField(file.fields, 'idempotencyKey');
    if (!idempotencyKey) {
      throw new BulkMediaIdempotencyKeyRequiredError();
    }

    const { tenantId, userId } = this.tenantContext.requireContext();
    return this.bulkMedia.create({
      tenantId,
      createdByUserId: userId,
      idempotencyKey,
      caption: readStringField(file.fields, 'caption'),
      fileName: file.filename || 'foto.jpg',
      mimeType: file.mimetype,
      buffer,
      conversationIds,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bulkMedia.findOne(id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.bulkMedia.retry(id);
  }
}

function parseConversationIds(value: string | null): string[] {
  if (!value) {
    throw new BulkMediaInvalidRecipientsError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BulkMediaInvalidRecipientsError('Formato de destinatários inválido.');
  }

  if (!Array.isArray(parsed)) {
    throw new BulkMediaInvalidRecipientsError('Formato de destinatários inválido.');
  }

  const ids = parsed.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  if (ids.length !== parsed.length) {
    throw new BulkMediaInvalidRecipientsError('Formato de destinatários inválido.');
  }

  return [...new Set(ids)];
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

function isFileTooLargeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: string; code?: string };
  return (
    candidate.name === 'RequestFileTooLargeError' || candidate.code === 'FST_REQ_FILE_TOO_LARGE'
  );
}
