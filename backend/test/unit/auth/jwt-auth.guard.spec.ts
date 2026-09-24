import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { Env } from '../../../src/config/env.validation.js';
import { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import { InvalidAccessTokenError } from '../../../src/modules/auth/auth.errors.js';
import { JwtAuthGuard } from '../../../src/modules/auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../../../src/modules/auth/auth.types.js';
import type { MembershipsService } from '../../../src/modules/memberships/memberships.service.js';

const tenant = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

interface Harness {
  guard: JwtAuthGuard;
  request: AuthenticatedRequest;
  tenantContext: TenantContextService;
  memberships: { resolveContext: ReturnType<typeof vi.fn> };
  jwt: { verifyAsync: ReturnType<typeof vi.fn> };
  reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
}

function createHarness(): Harness {
  const reflector = { getAllAndOverride: vi.fn(() => false) };
  const jwt = { verifyAsync: vi.fn() };
  const config = { getOrThrow: vi.fn(() => 'access-secret') };
  const memberships = { resolveContext: vi.fn() };
  const tenantContext = new TenantContextService();

  const request = {
    headers: { authorization: 'Bearer access-token' },
  } as unknown as AuthenticatedRequest;

  const guard = new JwtAuthGuard(
    reflector as unknown as Reflector,
    jwt as unknown as JwtService,
    config as unknown as ConfigService<Env, true>,
    memberships as unknown as MembershipsService,
    tenantContext,
  );

  return { guard, request, tenantContext, memberships, jwt, reflector };
}

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('allows public routes without a token', async () => {
    const { guard, request, reflector } = createHarness();
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
  });

  it('rejects a missing token', async () => {
    const { guard, request } = createHarness();
    request.headers.authorization = undefined;

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects an invalid token', async () => {
    const { guard, request, jwt } = createHarness();
    jwt.verifyAsync.mockRejectedValue(new Error('bad signature'));

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('validates membership and fills the tenant context', async () => {
    const { guard, request, jwt, memberships, tenantContext } = createHarness();
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1' });
    memberships.resolveContext.mockResolvedValue(tenant);

    await tenantContext.run({}, async () => {
      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

      expect(memberships.resolveContext).toHaveBeenCalledWith('user-1', 'tenant-1');
      expect(tenantContext.getContext()).toEqual(tenant);
      expect(request.auth).toEqual(tenant);
    });
  });

  it('does not trust token membership when the membership is invalid', async () => {
    const { guard, request, jwt, memberships } = createHarness();
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-2', role: 'OWNER' });
    memberships.resolveContext.mockRejectedValue(new Error('denied'));

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow('denied');
  });
});
