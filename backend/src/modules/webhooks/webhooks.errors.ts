import { AppException } from '../../common/errors/app.exception.js';

export class WebhookUnauthorizedError extends AppException {
  constructor() {
    super('WEBHOOK_UNAUTHORIZED', 'Invalid webhook secret', 401);
  }
}
