import { AppException } from '../../common/errors/app.exception.js';

export class CustomerNotFoundError extends AppException {
  constructor() {
    super('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
  }
}

export class CustomerDocumentConflictError extends AppException {
  constructor() {
    super('CUSTOMER_DOCUMENT_CONFLICT', 'A customer with this document already exists', 409);
  }
}

export class CustomerTagNotFoundError extends AppException {
  constructor() {
    super('CUSTOMER_TAG_NOT_FOUND', 'One or more tags were not found', 404);
  }
}
