import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppException } from '../../errors/app.exception.js';
import type { Env } from '../../../config/env.validation.js';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator.js';
import { RateLimitService } from './rate-limit.service.js';

export class RateLimitedError extends AppException {
  constructor() {
    super('RATE_LIMITED', 'Too many requests. Try again later.', 429);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled = this.config.get('RATE_LIMIT_ENABLED') ?? true;
    if (!enabled) {
      return true;
    }

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';

    if (!this.limiter.hit(`${options.name}:${ip}`, options.limit, options.windowMs)) {
      throw new RateLimitedError();
    }

    return true;
  }
}
