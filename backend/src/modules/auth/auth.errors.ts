import { AppException } from '../../common/errors/app.exception.js';

export class InvalidCredentialsError extends AppException {
  constructor() {
    super('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  }
}

export class UserInactiveError extends AppException {
  constructor() {
    super('USER_INACTIVE', 'User is not active', 403);
  }
}

export class InvalidAccessTokenError extends AppException {
  constructor() {
    super('INVALID_ACCESS_TOKEN', 'Access token is invalid or missing', 401);
  }
}

export class InvalidRefreshTokenError extends AppException {
  constructor() {
    super('INVALID_REFRESH_TOKEN', 'Refresh token is invalid', 401);
  }
}

export class RefreshTokenExpiredError extends AppException {
  constructor() {
    super('REFRESH_TOKEN_EXPIRED', 'Refresh token has expired', 401);
  }
}

export class RefreshTokenReuseError extends AppException {
  constructor() {
    super('REFRESH_TOKEN_REUSE', 'Refresh token reuse detected', 401);
  }
}

export class NoActiveMembershipError extends AppException {
  constructor() {
    super('NO_ACTIVE_MEMBERSHIP', 'User has no active membership', 403);
  }
}

export class TenantRequiredError extends AppException {
  constructor() {
    super('TENANT_REQUIRED', 'tenantId is required when the user has multiple memberships', 400);
  }
}

export class ForbiddenRoleError extends AppException {
  constructor() {
    super('FORBIDDEN', 'Insufficient role for this operation', 403);
  }
}

export class InvalidPasswordResetTokenError extends AppException {
  constructor() {
    super(
      'INVALID_PASSWORD_RESET_TOKEN',
      'O link de recuperação de senha é inválido, expirou ou já foi utilizado.',
      400,
    );
  }
}

export class InvalidCurrentPasswordError extends AppException {
  constructor() {
    super('INVALID_CURRENT_PASSWORD', 'Current password is incorrect', 400);
  }
}

export class InvalidAvatarError extends AppException {
  constructor() {
    super(
      'INVALID_AVATAR',
      'Envie uma imagem JPEG, PNG ou WebP válida para usar como foto de perfil.',
      422,
    );
  }
}

export class AvatarTooLargeError extends AppException {
  constructor() {
    super('AVATAR_TOO_LARGE', 'A imagem deve ter no máximo 5 MB.', 413);
  }
}

export class AvatarNotFoundError extends AppException {
  constructor() {
    super('AVATAR_NOT_FOUND', 'Este usuário não possui foto de perfil.', 404);
  }
}
