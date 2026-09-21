import { HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { HealthController } from '../../../src/modules/health/health.controller.js';

type StatusMock = ReturnType<typeof vi.fn>;

function createController(options: {
  databaseUp: boolean;
  redisUp: boolean;
}): { controller: HealthController; status: StatusMock } {
  const prisma = {
    $queryRaw: options.databaseUp
      ? vi.fn().mockResolvedValue([{ ok: 1 }])
      : vi.fn().mockRejectedValue(new Error('database down')),
  } as unknown as PrismaService;

  const redis = {
    ping: options.redisUp
      ? vi.fn().mockResolvedValue('PONG')
      : vi.fn().mockRejectedValue(new Error('redis down')),
  } as unknown as Redis;

  const status = vi.fn();

  return { controller: new HealthController(prisma, redis), status };
}

describe('HealthController', () => {
  it('reports ok when every dependency is up', async () => {
    const { controller } = createController({ databaseUp: true, redisUp: true });

    const result = await controller.check({ status: vi.fn() } as unknown as FastifyReply);

    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ api: 'up', database: 'up', redis: 'up' });
  });

  it('reports error and 503 when a dependency is down', async () => {
    const { controller, status } = createController({ databaseUp: true, redisUp: false });

    const result = await controller.check({ status } as unknown as FastifyReply);

    expect(result.status).toBe('error');
    expect(result.checks.redis).toBe('down');
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('does not leak dependency error details', async () => {
    const { controller } = createController({ databaseUp: false, redisUp: false });

    const result = await controller.check({ status: vi.fn() } as unknown as FastifyReply);

    expect(JSON.stringify(result)).not.toContain('database down');
    expect(JSON.stringify(result)).not.toContain('redis down');
    expect(result.checks).toEqual({ api: 'up', database: 'down', redis: 'down' });
  });
});
