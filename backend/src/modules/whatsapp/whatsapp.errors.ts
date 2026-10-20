import { AppException } from '../../common/errors/app.exception.js';

export class WhatsAppInstanceNotFoundError extends AppException {
  constructor() {
    super('WHATSAPP_INSTANCE_NOT_FOUND', 'WhatsApp instance not found', 404);
  }
}

export class WhatsAppInstanceNameConflictError extends AppException {
  constructor() {
    super('WHATSAPP_INSTANCE_NAME_CONFLICT', 'An instance with this name already exists', 409);
  }
}

export class WhatsAppInstanceLimitReachedError extends AppException {
  constructor(used: number) {
    const message =
      used === 0
        ? 'Não foi possível cadastrar uma nova instância WhatsApp. Entre em contato com o suporte.'
        : used === 1
          ? 'Sua organização já possui uma instância WhatsApp cadastrada. Para cadastrar uma nova, exclua a instância existente.'
          : 'Sua organização já possui instâncias WhatsApp cadastradas. Para cadastrar uma nova, exclua uma instância existente.';
    super('WHATSAPP_INSTANCE_LIMIT_REACHED', message, 409);
  }
}
