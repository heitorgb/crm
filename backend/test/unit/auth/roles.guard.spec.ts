import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import { InvalidAccessTokenError } from '../../../src/modules/auth/auth.errors.js';
import { RolesGuard } from '../../../src/modules/auth/guards/roles.guard.js';

function context(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = { getAllAndOverride: vi.fn(() => undefined) };
    const guard = new RolesGuard(reflector as unknown as Reflector, new TenantContextService());

    expect(guard.canActivate(context())).toBe(true);
  });

  it('allows when the context role is authorized', () => {
    const reflector = { getAllAndOverride: vi.fn<() => Role[]>(() => ['OWNER', 'ADMIN']) };
    const tenantContext = new TenantContextService();
    const guard = new RolesGuard(reflector as unknown as Reflector, tenantContext);

    tenantContext.run(
      {
        tenant: { tenantId: 't1', userId: 'u1', membershipId: 'm1', role: 'ADMIN' },
      },
      () => {
        expect(guard.canActivate(context())).toBe(true);
      },
    );
  });

  it('denies when the context role is not authorized', () => {
    const reflector = { getAllAndOverride: vi.fn<() => Role[]>(() => ['OWNER', 'ADMIN']) };
    const tenantContext = new TenantContextService();
    const guard = new RolesGuard(reflector as unknown as Reflector, tenantContext);

    tenantContext.run(
      {
        tenant: { tenantId: 't1', userId: 'u1', membershipId: 'm1', role: 'USER' },
      },
      () => {
        expect(() => guard.canActivate(context())).toThrow();
      },
    );
  });

  it('rejects when there is no authenticated context', () => {
    const reflector = { getAllAndOverride: vi.fn<() => Role[]>(() => ['OWNER']) };
    const guard = new RolesGuard(reflector as unknown as Reflector, new TenantContextService());

    expect(() => guard.canActivate(context())).toThrow(InvalidAccessTokenError);
  });
});
