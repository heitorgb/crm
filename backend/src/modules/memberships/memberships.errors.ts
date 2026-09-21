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
