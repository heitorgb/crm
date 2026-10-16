import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { BILLING_SCAN_INTERVAL_MS } from './billing.constants.js';
import { BillingRemindersService } from './billing-reminders.service.js';

@Injectable()
export class BillingSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
    private readonly reminders: BillingRemindersService,
    private readonly config: ConfigService<Env, true>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.BILLING_REMINDER_SEND, (payload) =>
      this.reminders.processReminder(payload),
    );
    this.queue.registerProcessor(JOB_NAMES.BILLING_SCAN, () => this.reminders.runScan());

    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }

    void this.queue
      .scheduleRepeatable(JOB_NAMES.BILLING_SCAN, BILLING_SCAN_INTERVAL_MS, {})
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not schedule billing scan: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
  }
}
