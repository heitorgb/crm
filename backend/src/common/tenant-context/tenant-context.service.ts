import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppException } from '../errors/app.exception.js';
import type { RequestContextStore, TenantContext } from './tenant-context.types.js';

export class TenantContextUnavailableError extends AppException {
  constructor() {
    super(
      'TENANT_CONTEXT_UNAVAILABLE',
      'Tenant context is not available for the current execution scope',
      500,
    );
  }
}

export class InvalidTenantContextError extends AppException {
  constructor() {
    super(
      'INVALID_TENANT_CONTEXT',
      'Tenant context must include tenantId, userId, membershipId and role',
      500,
    );
  }
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  getStore(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  getContext(): TenantContext | undefined {
    return this.storage.getStore()?.tenant;
  }

  requireContext(): TenantContext {
    const context = this.getContext();

    if (!context) {
      throw new TenantContextUnavailableError();
    }

    return context;
  }

  setContext(context: TenantContext): void {
    const store = this.storage.getStore();

    if (!store) {
      throw new TenantContextUnavailableError();
    }

    if (!isCompleteContext(context)) {
      throw new InvalidTenantContextError();
    }

    store.tenant = context;
  }

  clearContext(): void {
    const store = this.storage.getStore();

    if (store) {
      store.tenant = undefined;
    }
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }
}

function isCompleteContext(context: TenantContext): boolean {
  return (
    typeof context.tenantId === 'string' &&
    context.tenantId.length > 0 &&
    typeof context.userId === 'string' &&
    context.userId.length > 0 &&
    typeof context.membershipId === 'string' &&
    context.membershipId.length > 0 &&
    typeof context.role === 'string' &&
    context.role.length > 0
  );
}
