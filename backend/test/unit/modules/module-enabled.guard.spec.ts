import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import { InvalidAccessTokenError } from '../../../src/modules/auth/auth.errors.js';
import { ModuleEnabledGuard } from '../../../src/modules/modules/module-enabled.guard.js';
import { ModuleDisabledError } from '../../../src/modules/modules/modules.errors.js';
import type { ModulesService } from '../../../src/modules/modules/modules.service.js';

const tenant = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

function createHarness() {
  const reflector = { getAllAndOverride: vi.fn() };
  const modules = { isEnabled: vi.fn() };
  const tenantContext = new TenantContextService();

  const guard = new ModuleEnabledGuard(
    reflector as unknown as Reflector,
    tenantContext,
    modules as unknown as ModulesService,
  );

  const context = {
    getHandler: () => ({}),
    getClass: () => class {},
  } as unknown as ExecutionContext;

  return { guard, reflector, modules, tenantContext, context };
}

describe('ModuleEnabledGuard', () => {
  it('allows handlers without @RequireModule', async () => {
    const { guard, reflector, context } = createHarness();
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects when there is no tenant context', async () => {
    const { guard, reflector, context } = createHarness();
    reflector.getAllAndOverride.mockReturnValue('billing.collection');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a disabled module', async () => {
    const { guard, reflector, modules, tenantContext, context } = createHarness();
    reflector.getAllAndOverride.mockReturnValue('billing.collection');
    modules.isEnabled.mockResolvedValue(false);

    await tenantContext.run({ tenant }, async () => {
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ModuleDisabledError);
    });
  });

  it('allows an enabled module', async () => {
    const { guard, reflector, modules, tenantContext, context } = createHarness();
    reflector.getAllAndOverride.mockReturnValue('billing.collection');
    modules.isEnabled.mockResolvedValue(true);

    await tenantContext.run({ tenant }, async () => {
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(modules.isEnabled).toHaveBeenCalledWith('tenant-1', 'billing.collection');
    });
  });
});
