import { AppException } from '../../common/errors/app.exception.js';

export class LeadNotFoundError extends AppException {
  constructor() {
    super('LEAD_NOT_FOUND', 'Lead not found', 404);
  }
}

export class LeadIdentifierRequiredError extends AppException {
  constructor() {
    super('LEAD_IDENTIFIER_REQUIRED', 'Provide at least a name or a phone for the lead', 400);
  }
}

export class LeadPhoneConflictError extends AppException {
  constructor() {
    super('LEAD_PHONE_CONFLICT', 'A lead with this phone already exists', 409);
  }
}

export class LeadRelationNotFoundError extends AppException {
  constructor() {
    super('LEAD_RELATION_NOT_FOUND', 'Customer, contact or tag not found for this tenant', 404);
  }
}
