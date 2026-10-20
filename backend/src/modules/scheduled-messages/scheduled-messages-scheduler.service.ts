import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { ScheduledMessageSenderService } from './scheduled-message-sender.service.js';

@Injectable()
export class ScheduledMessagesSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledMessagesSchedulerService.name);

  constructor(
    private readonly sender: ScheduledMessageSenderService,
    private readonly config: ConfigService<Env, true>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.SCHEDULED_MESSAGE_SEND, (payload) =>
      this.sender.processOccurrence(payload),
    );
    this.queue.registerProcessor(JOB_NAMES.SCHEDULED_MESSAGE_SCAN, () => this.sender.scan());

    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }

    void this.queue
      .scheduleRepeatable(
        JOB_NAMES.SCHEDULED_MESSAGE_SCAN,
        this.config.get('SCHEDULED_MESSAGE_SCAN_INTERVAL_MS'),
        {},
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not schedule scheduled-message scan: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
  }
}
