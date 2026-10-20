import { AppException } from '../../common/errors/app.exception.js';

export class ScheduledMessageNotFoundError extends AppException {
  constructor() {
    super('SCHEDULED_MESSAGE_NOT_FOUND', 'Mensagem agendada não encontrada.', 404);
  }
}

export class ScheduledMessageNotEditableError extends AppException {
  constructor() {
    super('SCHEDULED_MESSAGE_NOT_EDITABLE', 'Apenas agendamentos ativos podem ser editados.', 409);
  }
}

export class ScheduledMessageInvalidDateError extends AppException {
  constructor(message = 'Informe uma data e hora futura.') {
    super('SCHEDULED_MESSAGE_INVALID_DATE', message, 400);
  }
}

export class ScheduledMessageInvalidRecipientsError extends AppException {
  constructor(message = 'Selecione ao menos um destinatário válido.') {
    super('SCHEDULED_MESSAGE_INVALID_RECIPIENTS', message, 400);
  }
}

export class ScheduledMessageTooManyRecipientsError extends AppException {
  constructor(max: number) {
    super(
      'SCHEDULED_MESSAGE_TOO_MANY_RECIPIENTS',
      `Selecione no máximo ${max} destinatários.`,
      400,
    );
  }
}

export class ScheduledMessageEmptyContentError extends AppException {
  constructor() {
    super('SCHEDULED_MESSAGE_EMPTY_CONTENT', 'O texto da mensagem é obrigatório.', 400);
  }
}

export class ScheduledMessageInvalidTypeError extends AppException {
  constructor() {
    super('SCHEDULED_MESSAGE_INVALID_TYPE', 'Tipo de mensagem inválido.', 400);
  }
}

export class ScheduledMessageAttachmentInvalidError extends AppException {
  constructor(message = 'Anexe uma imagem ou um PDF válido.') {
    super('SCHEDULED_MESSAGE_ATTACHMENT_INVALID', message, 422);
  }
}

export class ScheduledMessageAttachmentTooLargeError extends AppException {
  constructor() {
    super('SCHEDULED_MESSAGE_ATTACHMENT_TOO_LARGE', 'Arquivo maior que o permitido.', 413);
  }
}
