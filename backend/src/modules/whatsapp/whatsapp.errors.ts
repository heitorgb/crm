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
