import { AppException } from '../../common/errors/app.exception.js';

export class DataSubjectNotFoundError extends AppException {
  constructor() {
    super('DATA_SUBJECT_NOT_FOUND', 'Data subject record not found for this tenant', 404);
  }
}

export class LegalHoldActiveError extends AppException {
  constructor() {
    super(
      'LEGAL_HOLD_ACTIVE',
      'Record is under legal hold and cannot be erased until the hold is released',
      409,
    );
  }
}

export class ComplianceRequestNotFoundError extends AppException {
  constructor() {
    super('COMPLIANCE_REQUEST_NOT_FOUND', 'Data subject request not found', 404);
  }
}

export class ReviewNotResolvableError extends AppException {
  constructor() {
    super('REVIEW_NOT_RESOLVABLE', 'Session is not awaiting an automated decision review', 409);
  }
}
