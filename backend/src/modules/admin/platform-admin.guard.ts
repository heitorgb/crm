import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isPlatformAdminEmail } from '../../common/security/platform-admin.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { InvalidAccessTokenError } from '../auth/auth.errors.js';
import { PlatformAdminRequiredError } from './admin.errors.js';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(): Promise<boolean> {
    const tenant = this.tenantContext.getContext();
    if (!tenant) {
      throw new InvalidAccessTokenError();
    }

    const allowlist = this.config.get('PLATFORM_ADMIN_EMAILS');
    if (!allowlist || allowlist.length === 0) {
      throw new PlatformAdminRequiredError();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: tenant.userId },
      select: { email: true, active: true },
    });

    if (!user || !user.active || !isPlatformAdminEmail(user.email, allowlist)) {
      throw new PlatformAdminRequiredError();
    }

    return true;
  }
}
