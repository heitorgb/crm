import { AppException } from '../../common/errors/app.exception.js';

export class PlatformAdminRequiredError extends AppException {
  constructor() {
    super('PLATFORM_ADMIN_REQUIRED', 'Platform administrator access required', 403);
  }
}

export class TenantNotFoundError extends AppException {
  constructor() {
    super('TENANT_NOT_FOUND', 'Tenant not found', 404);
  }
}

export class MembershipAlreadyExistsError extends AppException {
  constructor() {
    super('MEMBERSHIP_ALREADY_EXISTS', 'User already belongs to this tenant', 409);
  }
}

export class MembershipNotFoundError extends AppException {
  constructor() {
    super('MEMBERSHIP_NOT_FOUND', 'Membership not found', 404);
  }
}

export class LastOwnerRequiredError extends AppException {
  constructor() {
    super('LAST_OWNER_REQUIRED', 'A tenant must keep at least one active owner', 409);
  }
}

export class PasswordRequiredError extends AppException {
  constructor() {
    super(
      'PASSWORD_REQUIRED',
      'A password is required to create a new user',
      400,
    );
  }
}
