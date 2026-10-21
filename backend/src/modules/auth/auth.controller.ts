import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from '../../common/errors/app.exception.js';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import type { Env } from '../../config/env.validation.js';
import type { IssuedSession, PublicUser, RequestMetadata } from './auth.types.js';
import { AvatarTooLargeError } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { Public } from './decorators/auth.decorators.js';
import { CurrentTenant } from './decorators/current-tenant.decorator.js';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  SwitchTenantDto,
  UpdateProfileDto,
} from './dto/auth.dto.js';

interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: IssuedSession['user'];
  tenant: IssuedSession['tenant'];
  role: IssuedSession['role'];
  membershipId: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'auth-login', limit: 10, windowMs: 60_000 })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const session = await this.auth.login(dto, metadataFrom(request));
    this.cookies.set(reply, session.refreshToken, session.refreshExpiresAt);

    return toAuthResponse(session);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'auth-refresh', limit: 30, windowMs: 60_000 })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const token = this.cookies.read(request) ?? dto.refreshToken;
    const session = await this.auth.refresh(token, metadataFrom(request));
    this.cookies.set(reply, session.refreshToken, session.refreshExpiresAt);

    return toAuthResponse(session);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = this.cookies.read(request) ?? dto.refreshToken;
    await this.auth.logout(token);
    this.cookies.clear(reply);
  }

  @Get('me')
  me(@CurrentTenant() context: TenantContext) {
    return this.auth.me(context);
  }

  @Patch('me')
  updateProfile(
    @CurrentTenant() context: TenantContext,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ id: string; name: string; email: string }> {
    return this.auth.updateProfile(context, dto);
  }

  @Post('me/avatar')
  @HttpCode(200)
  async updateAvatar(
    @CurrentTenant() context: TenantContext,
    @Req() request: FastifyRequest,
  ): Promise<PublicUser> {
    if (!request.isMultipart()) {
      throw new AppException('AVATAR_REQUIRED', 'Envie a imagem como multipart/form-data.', 400);
    }

    const file = await request.file({
      limits: { fileSize: this.config.get('AVATAR_MAX_BYTES'), files: 1 },
    });
    if (!file) {
      throw new AppException('AVATAR_REQUIRED', 'Nenhuma imagem foi enviada.', 400);
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if (isFileTooLargeError(error)) {
        throw new AvatarTooLargeError();
      }
      throw error;
    }

    return this.auth.updateAvatar(context, buffer);
  }

  @Delete('me/avatar')
  removeAvatar(@CurrentTenant() context: TenantContext): Promise<PublicUser> {
    return this.auth.removeAvatar(context);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentTenant() context: TenantContext,
    @Body() dto: ChangePasswordDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const currentToken = this.cookies.read(request);
    await this.auth.changePassword(context, dto, currentToken);
  }

  @Post('switch-tenant')
  @HttpCode(200)
  async switchTenant(
    @CurrentTenant() context: TenantContext,
    @Body() dto: SwitchTenantDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const currentToken = this.cookies.read(request);
    const session = await this.auth.switchTenant(context, dto.tenantId, metadataFrom(request), currentToken);
    this.cookies.set(reply, session.refreshToken, session.refreshExpiresAt);

    return toAuthResponse(session);
  }
}

function toAuthResponse(session: IssuedSession): AuthResponse {
  return {
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: session.expiresIn,
    user: session.user,
    tenant: session.tenant,
    role: session.role,
    membershipId: session.membershipId,
  };
}

function metadataFrom(request: FastifyRequest): RequestMetadata {
  const userAgent = request.headers['user-agent'];

  return {
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    ipAddress: request.ip,
  };
}

function isFileTooLargeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: string; code?: string };
  return (
    candidate.name === 'RequestFileTooLargeError' || candidate.code === 'FST_REQ_FILE_TOO_LARGE'
  );
}
