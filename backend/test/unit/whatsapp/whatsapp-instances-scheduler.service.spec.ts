import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import { JOB_NAMES } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { WhatsAppInstancesService } from '../../../src/modules/whatsapp/whatsapp-instances.service.js';
import { WhatsAppInstancesSchedulerService } from '../../../src/modules/whatsapp/whatsapp-instances-scheduler.service.js';

function createHarness(nodeEnv: string) {
  const queue = {
    registerProcessor: vi.fn(),
    scheduleRepeatable: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn(),
    close: vi.fn(),
  };
  const instances = {
    reconcileConnectionStates: vi.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'NODE_ENV') return nodeEnv;
      if (key === 'WHATSAPP_INSTANCE_RECONCILE_INTERVAL_MS') return 60_000;
      return undefined;
    }),
  };

  const service = new WhatsAppInstancesSchedulerService(
    instances as unknown as WhatsAppInstancesService,
    config as unknown as ConfigService<Env, true>,
    queue as unknown as JobQueue,
  );

  return { service, queue, instances };
}

describe('WhatsAppInstancesSchedulerService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the reconciliation processor', () => {
    const { service, queue } = createHarness('test');

    service.onModuleInit();

    expect(queue.registerProcessor).toHaveBeenCalledWith(
      JOB_NAMES.WHATSAPP_INSTANCE_RECONCILE,
      expect.any(Function),
    );
  });

  it('does not schedule jobs in the test environment', () => {
    const { service, queue } = createHarness('test');

    service.onModuleInit();

    expect(queue.scheduleRepeatable).not.toHaveBeenCalled();
  });

  it('schedules the 60 second reconciliation and runs an initial pass after boot', async () => {
    vi.useFakeTimers();
    const { service, queue, instances } = createHarness('production');

    service.onModuleInit();

    expect(queue.scheduleRepeatable).toHaveBeenCalledWith(
      JOB_NAMES.WHATSAPP_INSTANCE_RECONCILE,
      60_000,
      {},
    );

    await vi.advanceTimersByTimeAsync(10_000);

    expect(instances.reconcileConnectionStates).toHaveBeenCalledTimes(1);
  });
});
