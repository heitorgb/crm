import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { AuthService } from '../../../src/modules/auth/auth.service.js';
import {
  InvalidCurrentPasswordError,
  UserInactiveError,
} from '../../../src/modules/auth/auth.errors.js';
import type { PasswordService } from '../../../src/modules/auth/password.service.js';
import type { RefreshTokenService } from '../../../src/modules/auth/refresh-token.service.js';
import type { MembershipsService } from '../../../src/modules/memberships/memberships.service.js';

const context: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

function createService() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const passwords = {
    verify: vi.fn(),
    hash: vi.fn(async () => 'new-hash'),
  };
  const refreshTokens = { revokeAllForUser: vi.fn() };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    refreshTokens as unknown as RefreshTokenService,
    {} as JwtService,
    {} as ConfigService<Env, true>,
    {} as MembershipsService,
  );

  return { service, prisma, passwords, refreshTokens };
}

describe('AuthService profile & password', () => {
  it('updates the profile name', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', active: true });
    prisma.user.update.mockResolvedValue({ id: 'user-1', name: 'Ana', email: 'ana@x.com' });

    await expect(service.updateProfile(context, { name: ' Ana ' })).resolves.toEqual({
      id: 'user-1',
      name: 'Ana',
      email: 'ana@x.com',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { name: 'Ana' },
    });
  });

  it('rejects updating an inactive user', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', active: false });

    await expect(service.updateProfile(context, { name: 'Ana' })).rejects.toBeInstanceOf(
      UserInactiveError,
    );
  });

  it('rejects a wrong current password', async () => {
    const { service, prisma, passwords } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      active: true,
      passwordHash: 'hash',
    });
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.changePassword(context, { currentPassword: 'wrong', newPassword: 'nova12345' }, 'tok'),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordError);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('updates the password and revokes the other sessions', async () => {
    const { service, prisma, passwords, refreshTokens } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      active: true,
      passwordHash: 'hash',
    });
    passwords.verify.mockResolvedValue(true);
    prisma.user.update.mockResolvedValue({});

    await service.changePassword(
      context,
      { currentPassword: 'atual12345', newPassword: 'nova12345' },
      'current-token',
    );

    expect(passwords.hash).toHaveBeenCalledWith('nova12345');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash' },
    });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1', 'current-token');
  });
});
