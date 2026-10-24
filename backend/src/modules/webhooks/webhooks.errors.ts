import { AppException } from '../../common/errors/app.exception.js';

export class WebhookUnauthorizedError extends AppException {
  constructor() {
    super('WEBHOOK_UNAUTHORIZED', 'Invalid webhook secret', 401);
  }
}

/**
 * A processing failure that is safe to retry. It is exposed as 5xx so Evolution
 * keeps the event in its own retry queue instead of acknowledging and dropping
 * it. The cause is kept for logs only, never for the response.
 */
export class WebhookProcessingError extends AppException {
  constructor(override readonly cause?: unknown) {
    super(
      'WEBHOOK_PROCESSING_FAILED',
      'Webhook event could not be processed; retry is safe',
      503,
    );
  }
}
