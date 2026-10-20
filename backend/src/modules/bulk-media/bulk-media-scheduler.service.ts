import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { BULK_MEDIA_SCAN_INTERVAL_MS } from './bulk-media.constants.js';
import { BulkMediaService } from './bulk-media.service.js';

@Injectable()
export class BulkMediaSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(BulkMediaSchedulerService.name);

  constructor(
    private readonly bulkMedia: BulkMediaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.BULK_MEDIA_SEND, (payload) =>
      this.bulkMedia.processBatch(payload),
    );
    this.queue.registerProcessor(JOB_NAMES.BULK_MEDIA_SCAN, () => this.bulkMedia.scan());

    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }

    void this.queue
      .scheduleRepeatable(JOB_NAMES.BULK_MEDIA_SCAN, BULK_MEDIA_SCAN_INTERVAL_MS, {})
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not schedule bulk media scan: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
  }
}
