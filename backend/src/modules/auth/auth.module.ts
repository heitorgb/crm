import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MediaModule } from '../../infrastructure/media/media.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { PasswordModule } from './password.module.js';
import { PasswordResetService } from './password-reset.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Module({
  imports: [JwtModule.register({}), MembershipsModule, PasswordModule, MediaModule, StorageModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    PasswordResetService,
    RefreshTokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, PasswordModule],
})
export class AuthModule {}
