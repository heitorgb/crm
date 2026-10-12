import { AppException } from '../../common/errors/app.exception.js';

export class TenantNotFoundError extends AppException {
  constructor() {
    super('TENANT_NOT_FOUND', 'Tenant not found', 404);
  }
}
