import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { BullmqJobQueue } from './bullmq-job.queue.js';
import { InlineJobQueue } from './inline-job.queue.js';
import { JOB_QUEUE } from './job-queue.types.js';

@Global()
@Module({
  providers: [
    {
      provide: JOB_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.getOrThrow('NODE_ENV');
        const driver = config.get('QUEUE_DRIVER');

        if (driver === 'inline' || nodeEnv === 'test') {
          return new InlineJobQueue();
        }

        return new BullmqJobQueue(config.getOrThrow('REDIS_URL'));
      },
    },
  ],
  exports: [JOB_QUEUE],
})
export class QueueModule {}
