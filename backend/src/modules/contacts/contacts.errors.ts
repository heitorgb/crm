import { AppException } from '../../common/errors/app.exception.js';

export class ContactNotFoundError extends AppException {
  constructor() {
    super('CONTACT_NOT_FOUND', 'Contact not found', 404);
  }
}

export class ContactCustomerNotFoundError extends AppException {
  constructor() {
    super('CONTACT_CUSTOMER_NOT_FOUND', 'Customer not found for this tenant', 404);
  }
}

export class ContactPhoneConflictError extends AppException {
  constructor() {
    super('CONTACT_PHONE_CONFLICT', 'A contact with this phone already exists', 409);
  }
}
