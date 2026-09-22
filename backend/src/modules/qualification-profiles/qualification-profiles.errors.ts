import { AppException } from '../../common/errors/app.exception.js';

export class QualificationProfileNotFoundError extends AppException {
  constructor() {
    super('QUALIFICATION_PROFILE_NOT_FOUND', 'Qualification profile not found', 404);
  }
}
