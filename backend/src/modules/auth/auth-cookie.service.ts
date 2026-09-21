import '@fastify/cookie';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.validation.js';
import { REFRESH_COOKIE_NAME } from './auth.constants.js';

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  set(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(REFRESH_COOKIE_NAME, token, { ...this.baseOptions(), expires: expiresAt });
  }

  clear(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE_NAME, this.baseOptions());
  }

  read(request: FastifyRequest): string | undefined {
    return request.cookies?.[REFRESH_COOKIE_NAME];
  }

  private baseOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    path: string;
    domain?: string;
  } {
    const secure =
      this.config.get('AUTH_COOKIE_SECURE') ??
      (this.config.getOrThrow('NODE_ENV') === 'production');

    return {
      httpOnly: true,
      secure,
      sameSite: this.config.getOrThrow('AUTH_COOKIE_SAMESITE'),
      path: `/${this.config.getOrThrow('API_PREFIX')}/auth`,
      domain: this.config.get('AUTH_COOKIE_DOMAIN'),
    };
  }
}
