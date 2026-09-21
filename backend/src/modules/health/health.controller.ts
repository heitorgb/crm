import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants.js';
import { Public } from '../auth/decorators/auth.decorators.js';

type DependencyStatus = 'up' | 'down';

interface HealthResponse {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
  checks: {
    api: DependencyStatus;
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

const CHECK_TIMEOUT_MS = 2000;

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const healthy = database === 'up' && redis === 'up';

    if (!healthy) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: healthy ? 'ok' : 'error',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: { api: 'up', database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      const pong = await this.withTimeout(this.redis.ping());
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Health check timed out')), CHECK_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
