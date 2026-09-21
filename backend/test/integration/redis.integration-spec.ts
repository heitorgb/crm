import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { validateEnv } from '../../src/config/env.validation.js';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.constants.js';
import { RedisModule } from '../../src/infrastructure/redis/redis.module.js';

describe('RedisModule (integration)', () => {
  let client: Redis;
  let closeModule: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), RedisModule],
    }).compile();

    client = moduleRef.get<Redis>(REDIS_CLIENT);
    closeModule = () => moduleRef.close();

    if (client.status === 'wait') {
      await client.connect();
    }
  });

  afterAll(async () => {
    await closeModule();
  });

  it('connects to Redis', async () => {
    await expect(client.ping()).resolves.toBe('PONG');
  });
});
