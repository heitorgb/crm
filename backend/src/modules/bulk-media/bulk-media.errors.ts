import { AppException } from '../../common/errors/app.exception.js';

export class BulkMediaBatchNotFoundError extends AppException {
  constructor() {
    super('BULK_MEDIA_BATCH_NOT_FOUND', 'Envio de fotos não encontrado.', 404);
  }
}

export class BulkMediaInvalidImageError extends AppException {
  constructor() {
    super('BULK_MEDIA_INVALID_IMAGE', 'Envie uma imagem válida.', 422);
  }
}

export class BulkMediaInvalidRecipientsError extends AppException {
  constructor(message = 'Selecione ao menos uma conversa válida para enviar a foto.') {
    super('BULK_MEDIA_INVALID_RECIPIENTS', message, 400);
  }
}

export class BulkMediaTooManyRecipientsError extends AppException {
  constructor(max: number) {
    super('BULK_MEDIA_TOO_MANY_RECIPIENTS', `Selecione no máximo ${max} conversas por envio.`, 400);
  }
}

export class BulkMediaIdempotencyKeyRequiredError extends AppException {
  constructor() {
    super('BULK_MEDIA_IDEMPOTENCY_KEY_REQUIRED', 'A chave de idempotência é obrigatória.', 400);
  }
}
