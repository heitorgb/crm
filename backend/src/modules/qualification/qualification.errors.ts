import { AppException } from '../../common/errors/app.exception.js';

export class QualificationLeadNotFoundError extends AppException {
  constructor() {
    super('QUALIFICATION_LEAD_NOT_FOUND', 'Lead not found for this tenant', 404);
  }
}

export class QualificationProfileUnavailableError extends AppException {
  constructor() {
    super(
      'QUALIFICATION_PROFILE_UNAVAILABLE',
      'No active qualification profile available for this tenant',
      409,
    );
  }
}

export class QualificationSessionNotFoundError extends AppException {
  constructor() {
    super('QUALIFICATION_SESSION_NOT_FOUND', 'Qualification session not found', 404);
  }
}

export class QualificationAnalysisNotFoundError extends AppException {
  constructor() {
    super('QUALIFICATION_ANALYSIS_NOT_FOUND', 'Qualification analysis not found', 404);
  }
}

export class QualificationSessionNotActiveError extends AppException {
  constructor() {
    super('QUALIFICATION_SESSION_NOT_ACTIVE', 'Qualification session is not accepting messages', 409);
  }
}

export class QualificationSessionNotCompletedError extends AppException {
  constructor() {
    super('QUALIFICATION_SESSION_NOT_COMPLETED', 'Qualification session is not completed', 409);
  }
}
