import {
  TenantContextService,
  TenantContextUnavailableError,
} from '../../../src/common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';

const context: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'membership-1',
  role: 'owner',
};

describe('TenantContextService', () => {
  let service: TenantContextService;

  beforeEach(() => {
    service = new TenantContextService();
  });

  it('has no context outside of a store', () => {
    expect(service.getContext()).toBeUndefined();
    expect(service.getRequestId()).toBeUndefined();
  });

  it('propagates context across asynchronous boundaries', async () => {
    await service.run({ requestId: 'request-1' }, async () => {
      service.setContext(context);
      await Promise.resolve();

      expect(service.getRequestId()).toBe('request-1');
      expect(service.requireContext()).toEqual(context);
    });

    expect(service.getContext()).toBeUndefined();
  });

  it('keeps contexts isolated between concurrent executions', async () => {
    const [first, second] = await Promise.all([
      service.run({ requestId: 'request-1' }, async () => {
        service.setContext(context);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return service.requireContext();
      }),
      service.run({ requestId: 'request-2' }, async () => {
        service.setContext({ ...context, tenantId: 'tenant-2' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        return service.requireContext();
      }),
    ]);

    expect(first.tenantId).toBe('tenant-1');
    expect(second.tenantId).toBe('tenant-2');
  });

  it('throws when requiring a missing context', () => {
    expect(() => service.requireContext()).toThrow(TenantContextUnavailableError);
  });

  it('throws when setting context without an active store', () => {
    expect(() => service.setContext(context)).toThrow(TenantContextUnavailableError);
  });
});
