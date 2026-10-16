import { AppException } from '../../common/errors/app.exception.js';

export class ModuleDisabledError extends AppException {
  constructor(moduleKey: string) {
    super(
      'MODULE_DISABLED',
      'Esta funcionalidade está desativada para a organização.',
      403,
      { module: moduleKey },
    );
  }
}

export class ModuleNotFoundError extends AppException {
  constructor() {
    super('MODULE_NOT_FOUND', 'Module not found', 404);
  }
}

export class ModuleNotControllableError extends AppException {
  constructor() {
    super('MODULE_NOT_CONTROLLABLE', 'This module cannot be managed per organization', 409);
  }
}

export class ModuleTenantNotFoundError extends AppException {
  constructor() {
    super('TENANT_NOT_FOUND', 'Tenant not found', 404);
  }
}
