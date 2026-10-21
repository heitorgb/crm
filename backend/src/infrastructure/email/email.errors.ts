import { AppException } from '../../common/errors/app.exception.js';

export class EmailNotConfiguredError extends AppException {
  constructor() {
    super(
      'EMAIL_NOT_CONFIGURED',
      'O envio de e-mails não está configurado. Tente novamente mais tarde.',
      503,
    );
  }
}

export class EmailDeliveryError extends AppException {
  constructor() {
    super(
      'EMAIL_DELIVERY_FAILED',
      'Não foi possível enviar o e-mail de recuperação agora. Tente novamente mais tarde.',
      502,
    );
  }
}
