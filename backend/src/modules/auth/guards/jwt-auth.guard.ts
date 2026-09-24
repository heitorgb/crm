import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../../config/env.validation.js';
import { TenantContextService } from '../../../common/tenant-context/tenant-context.service.js';
import { MembershipsService } from '../../memberships/memberships.service.js';
import { IS_PUBLIC_KEY } from '../auth.constants.js';
import { InvalidAccessTokenError } from '../auth.errors.js';
import { extractBearerToken, type AccessTokenPayload, type AuthenticatedRequest } from '../auth.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly memberships: MembershipsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new InvalidAccessTokenError();
    }

    const payload = await this.verify(token);

    const tenant = await this.memberships.resolveContext(payload.sub, payload.tenantId);

    this.tenantContext.setContext(tenant);
    request.auth = tenant;

    return true;
  }

  private async verify(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });

      if (!payload.sub || !payload.tenantId) {
        throw new Error('Incomplete access token payload');
      }

      return payload;
    } catch {
      throw new InvalidAccessTokenError();
    }
  }
}
