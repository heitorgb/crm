import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { MediaProcessingService } from '../../../src/infrastructure/media/media-processing.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { StorageService } from '../../../src/infrastructure/storage/storage.types.js';
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
  const media = {
    detectImageFormat: vi.fn(),
    optimizeAvatar: vi.fn(),
  };
  const storage = {
    put: vi.fn(async () => undefined),
    get: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(async () => undefined),
  };
  const config = {
    get: vi.fn((key: string) => (key === 'AVATAR_MAX_BYTES' ? 5_242_880 : undefined)),
  };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    refreshTokens as unknown as RefreshTokenService,
    {} as JwtService,
    config as unknown as ConfigService<Env, true>,
    {} as MembershipsService,
    media as unknown as MediaProcessingService,
    storage as unknown as StorageService,
  );

  return { service, prisma, passwords, refreshTokens, media, storage };
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
      avatarUrl: null,
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

  it('stores an optimized avatar and removes the previous file', async () => {
    const { service, prisma, media, storage } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Ana',
      email: 'ana@x.com',
      active: true,
      avatarStorageKey: 'users/user-1/avatar/old.jpg',
      avatarUpdatedAt: null,
    });
    media.detectImageFormat.mockResolvedValue('png');
    media.optimizeAvatar.mockResolvedValue({
      buffer: Buffer.from('jpeg'),
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: 512,
      height: 512,
      size: 4,
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      name: 'Ana',
      email: 'ana@x.com',
      avatarStorageKey: 'users/user-1/avatar/new.jpg',
      avatarUpdatedAt: new Date('2026-10-21T12:00:00.000Z'),
    });

    const result = await service.updateAvatar(context, Buffer.from('image'));

    expect(media.optimizeAvatar).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/user-1\/avatar\/.+\.jpg$/),
      expect.any(Buffer),
    );
    expect(storage.delete).toHaveBeenCalledWith('users/user-1/avatar/old.jpg');
    expect(result.avatarUrl).toBe(
      `/members/member-1/avatar?v=${new Date('2026-10-21T12:00:00.000Z').getTime()}`,
    );
  });

  it('rejects a file that is not an allowed image', async () => {
    const { service, media } = createService();
    media.detectImageFormat.mockResolvedValue('gif');

    await expect(service.updateAvatar(context, Buffer.from('image'))).rejects.toMatchObject({
      code: 'INVALID_AVATAR',
    });
  });
});
