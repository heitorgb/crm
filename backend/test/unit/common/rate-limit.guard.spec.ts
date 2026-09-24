import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { RateLimitGuard, RateLimitedError } from '../../../src/common/http/rate-limit/rate-limit.guard.js';
import { RateLimitService } from '../../../src/common/http/rate-limit/rate-limit.service.js';
import type { Env } from '../../../src/config/env.validation.js';

function contextFor(ip = '10.0.0.1'): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ ip, socket: { remoteAddress: ip } }) }),
  } as unknown as ExecutionContext;
}

function createGuard(options: {
  enabled?: boolean;
  limitOptions?: { name: string; limit: number; windowMs: number } | undefined;
}): { guard: RateLimitGuard; limiter: RateLimitService } {
  const limiter = new RateLimitService();
  const reflector = {
    getAllAndOverride: vi.fn(() => options.limitOptions),
  } as unknown as Reflector;
  const config = {
    get: vi.fn(() => options.enabled ?? true),
  } as unknown as ConfigService<Env, true>;

  return { guard: new RateLimitGuard(reflector, limiter, config), limiter };
}

describe('RateLimitService', () => {
  it('allows up to the limit and blocks the next hit within the window', () => {
    const limiter = new RateLimitService();

    expect(limiter.hit('k', 2, 1000, 0)).toBe(true);
    expect(limiter.hit('k', 2, 1000, 10)).toBe(true);
    expect(limiter.hit('k', 2, 1000, 20)).toBe(false);
  });

  it('frees the slot after the window elapses', () => {
    const limiter = new RateLimitService();

    expect(limiter.hit('k', 1, 1000, 0)).toBe(true);
    expect(limiter.hit('k', 1, 1000, 500)).toBe(false);
    expect(limiter.hit('k', 1, 1000, 1500)).toBe(true);
  });

  it('isolates keys from each other', () => {
    const limiter = new RateLimitService();

    expect(limiter.hit('a', 1, 1000, 0)).toBe(true);
    expect(limiter.hit('b', 1, 1000, 0)).toBe(true);
    expect(limiter.hit('a', 1, 1000, 0)).toBe(false);
  });
});

describe('RateLimitGuard', () => {
  it('is a no-op when disabled or when no metadata is present', () => {
    const disabled = createGuard({ enabled: false });
    expect(disabled.guard.canActivate(contextFor())).toBe(true);

    const noMetadata = createGuard({ limitOptions: undefined });
    expect(noMetadata.guard.canActivate(contextFor())).toBe(true);
  });

  it('throws RateLimitedError once the limit is exceeded', () => {
    const { guard } = createGuard({
      limitOptions: { name: 'auth-login', limit: 1, windowMs: 60_000 },
    });
    const context = contextFor('10.0.0.9');

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(RateLimitedError);
  });

  it('tracks different IPs independently', () => {
    const { guard } = createGuard({
      limitOptions: { name: 'auth-login', limit: 1, windowMs: 60_000 },
    });

    expect(guard.canActivate(contextFor('10.0.0.1'))).toBe(true);
    expect(guard.canActivate(contextFor('10.0.0.2'))).toBe(true);
  });
});
