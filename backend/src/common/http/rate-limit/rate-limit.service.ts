import { Injectable } from '@nestjs/common';

const MAX_TRACKED_KEYS = 10_000;

@Injectable()
export class RateLimitService {
  private readonly hits = new Map<string, number[]>();

  hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const threshold = now - windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > threshold);

    if (timestamps.length >= limit) {
      this.hits.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    if (this.hits.size > MAX_TRACKED_KEYS) {
      this.cleanup(threshold);
    }

    return true;
  }

  reset(): void {
    this.hits.clear();
  }

  private cleanup(threshold: number): void {
    for (const [key, timestamps] of this.hits) {
      const kept = timestamps.filter((timestamp) => timestamp > threshold);
      if (kept.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, kept);
      }
    }
  }
}
