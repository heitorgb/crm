import { AppException } from '../../common/errors/app.exception.js';

export class CustomMenuGroupNotFoundError extends AppException {
  constructor() {
    super('CUSTOM_MENU_GROUP_NOT_FOUND', 'Grupo de menu não encontrado', 404);
  }
}

export class CustomMenuButtonNotFoundError extends AppException {
  constructor() {
    super('CUSTOM_MENU_BUTTON_NOT_FOUND', 'Botão de menu não encontrado', 404);
  }
}

export class InvalidCustomMenuPayloadError extends AppException {
  constructor(message: string) {
    super('INVALID_CUSTOM_MENU_PAYLOAD', message, 400);
  }
}
