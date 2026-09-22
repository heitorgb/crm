import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { JobPayload, JobProcessor, JobQueue } from './job-queue.types.js';

const QUEUE_NAME = 'orderup';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: 200,
};

export class BullmqJobQueue implements JobQueue, OnModuleDestroy {
  private readonly logger = new Logger(BullmqJobQueue.name);
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly processors = new Map<string, JobProcessor>();

  constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const processor = this.processors.get(job.name);
        if (!processor) {
          throw new Error(`No processor registered for job ${job.name}`);
        }
        await processor(job.data as JobPayload);
      },
      { connection: this.connection, concurrency: 5 },
    );

    this.worker.on('error', (error: Error) => {
      this.logger.warn(`Queue worker error: ${error.message}`);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.warn(
        `Job ${job?.name ?? 'unknown'} failed (attempt ${job?.attemptsMade ?? 0}): ${error.message}`,
      );
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.name} completed`);
    });
  }

  async enqueue(name: string, payload: JobPayload): Promise<void> {
    await this.queue.add(name, payload, DEFAULT_JOB_OPTIONS);
  }

  registerProcessor(name: string, processor: JobProcessor): void {
    this.processors.set(name, processor);
  }

  async scheduleRepeatable(name: string, everyMs: number, payload: JobPayload): Promise<void> {
    await this.queue.upsertJobScheduler(
      `${name}:schedule`,
      { every: everyMs },
      { name, data: payload },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    await this.worker.close().catch(() => undefined);
    await this.queue.close().catch(() => undefined);
    if (this.connection.status !== 'end') {
      await this.connection.quit().catch(() => undefined);
    }
  }
}
