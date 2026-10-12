import { AppException } from '../../common/errors/app.exception.js';

export class TenantAccessDeniedError extends AppException {
  constructor() {
    super('TENANT_ACCESS_DENIED', 'No active membership for the requested tenant', 403);
  }
}

export class MembershipNotFoundError extends AppException {
  constructor() {
    super('MEMBERSHIP_NOT_FOUND', 'Membership not found', 404);
  }
}

export class MembershipAlreadyExistsError extends AppException {
  constructor() {
    super('MEMBERSHIP_ALREADY_EXISTS', 'User already belongs to this tenant', 409);
  }
}

export class MemberPasswordRequiredError extends AppException {
  constructor() {
    super('PASSWORD_REQUIRED', 'A password is required to create a new user', 400);
  }
}

export class LastOwnerRequiredError extends AppException {
  constructor() {
    super('LAST_OWNER_REQUIRED', 'A tenant must keep at least one active owner', 409);
  }
}
