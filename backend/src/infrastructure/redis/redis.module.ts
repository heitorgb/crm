import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.validation.js';
import { REDIS_CLIENT } from './redis.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const client = new Redis(config.getOrThrow('REDIS_URL'), {
          lazyConnect: true,
          connectTimeout: 3000,
          maxRetriesPerRequest: 1,
        });

        client.on('error', (error: Error) => {
          new Logger(RedisModule.name).warn(`Redis connection error: ${error.message}`);
        });

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connecting') {
      await this.client.quit().catch(() => undefined);
    }
  }
}
