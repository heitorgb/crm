import type { OnModuleDestroy } from '@nestjs/common';
import type { JobPayload, JobProcessor, JobQueue } from './job-queue.types.js';

export class InlineJobQueue implements JobQueue, OnModuleDestroy {
  private readonly processors = new Map<string, JobProcessor>();
  private readonly intervals: NodeJS.Timeout[] = [];

  async enqueue(name: string, payload: JobPayload): Promise<void> {
    await this.run(name, payload);
  }

  registerProcessor(name: string, processor: JobProcessor): void {
    this.processors.set(name, processor);
  }

  async scheduleRepeatable(name: string, everyMs: number, payload: JobPayload): Promise<void> {
    const interval = setInterval(() => {
      void this.run(name, payload);
    }, everyMs);
    interval.unref?.();
    this.intervals.push(interval);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.length = 0;
  }

  private async run(name: string, payload: JobPayload): Promise<void> {
    const processor = this.processors.get(name);
    if (!processor) {
      return;
    }
    await processor(payload);
  }
}
