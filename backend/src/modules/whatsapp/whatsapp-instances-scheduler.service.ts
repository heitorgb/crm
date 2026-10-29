import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { WhatsAppInstancesService } from './whatsapp-instances.service.js';

const INITIAL_RECONCILE_DELAY_MS = 10_000;

@Injectable()
export class WhatsAppInstancesSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppInstancesSchedulerService.name);

  constructor(
    private readonly instances: WhatsAppInstancesService,
    private readonly config: ConfigService<Env, true>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.WHATSAPP_INSTANCE_RECONCILE, () =>
      this.instances.reconcileConnectionStates(),
    );

    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }

    void this.queue
      .scheduleRepeatable(
        JOB_NAMES.WHATSAPP_INSTANCE_RECONCILE,
        this.config.get('WHATSAPP_INSTANCE_RECONCILE_INTERVAL_MS'),
        {},
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not schedule WhatsApp connection reconciliation: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });

    const timer = setTimeout(() => {
      void this.instances.reconcileConnectionStates().catch((error: unknown) => {
        this.logger.warn(
          `Initial WhatsApp connection reconciliation failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
    }, INITIAL_RECONCILE_DELAY_MS);
    timer.unref?.();
  }
}
