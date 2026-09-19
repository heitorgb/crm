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

    store.tenant = context;
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }
}
