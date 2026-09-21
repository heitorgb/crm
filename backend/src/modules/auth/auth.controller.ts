import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import type { IssuedSession, RequestMetadata } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { Public } from './decorators/auth.decorators.js';
import { CurrentTenant } from './decorators/current-tenant.decorator.js';
import { LoginDto, RefreshDto, SwitchTenantDto } from './dto/auth.dto.js';

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
  ) {}

  @Public()
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
