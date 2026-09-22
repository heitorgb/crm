import { AppException } from '../../../common/errors/app.exception.js';

export class AiProviderUnavailableError extends AppException {
  constructor(reason = 'AI provider is not configured') {
    super('AI_PROVIDER_UNAVAILABLE', reason, 503);
  }
}

export class AiProviderRequestError extends AppException {
  constructor(reason = 'AI provider request failed') {
    super('AI_PROVIDER_REQUEST_FAILED', reason, 502);
  }
}
