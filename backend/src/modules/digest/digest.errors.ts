import { AppException } from '../../common/errors/app.exception.js';

export class DigestPreferenceRequiredError extends AppException {
  constructor() {
    super('DIGEST_PREFERENCE_REQUIRED', 'Configure the digest preference before running it', 409);
  }
}
