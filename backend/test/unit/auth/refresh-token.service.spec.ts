import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import {
  InvalidRefreshTokenError,
  RefreshTokenExpiredError,
  RefreshTokenReuseError,
} from '../../../src/modules/auth/auth.errors.js';
import { RefreshTokenService } from '../../../src/modules/auth/refresh-token.service.js';

interface RefreshTokenRow {
  id: string;
  userId: string;
  tenantId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

type CreateRefreshTokenData = Omit<
  RefreshTokenRow,
  'id' | 'createdAt' | 'revokedAt' | 'replacedByTokenId'
> & {
  revokedAt?: Date | null;
  replacedByTokenId?: string | null;
};

function matches(row: RefreshTokenRow, where: Where): boolean {
  const record = row as unknown as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

function createFakePrisma(): { rows: RefreshTokenRow[]; prisma: PrismaService } {
  const rows: RefreshTokenRow[] = [];
  let sequence = 0;

  const prisma = {
    refreshToken: {
      findUnique: vi.fn(async ({ where }: { where: Where }) => {
        return rows.find((row) => matches(row, where)) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: CreateRefreshTokenData }) => {
        const row: RefreshTokenRow = {
          id: `id-${++sequence}`,
          createdAt: new Date(),
          userId: data.userId,
          tenantId: data.tenantId,
          tokenHash: data.tokenHash,
          familyId: data.familyId,
          expiresAt: data.expiresAt,
          revokedAt: data.revokedAt ?? null,
          replacedByTokenId: data.replacedByTokenId ?? null,
          userAgent: data.userAgent ?? null,
          ipAddress: data.ipAddress ?? null,
        };
        rows.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: Where; data: Partial<RefreshTokenRow> }) => {
        const row = rows.find((item) => matches(item, where));
        if (!row) {
          throw new Error('row not found');
        }
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<RefreshTokenRow> }) => {
        let count = 0;
        for (const row of rows) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
  } as unknown as PrismaService;

  return { rows, prisma };
}

const config = {
  getOrThrow: vi.fn((key: keyof Env) => (key === 'REFRESH_TOKEN_TTL_DAYS' ? 30 : undefined)),
} as unknown as ConfigService<Env, true>;

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

describe('RefreshTokenService', () => {
  it('stores only the hash of the issued token', async () => {
    const { rows, prisma } = createFakePrisma();
    const service = new RefreshTokenService(prisma, config);

    const issued = await service.issue('user-1', 'tenant-1', {});

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hash(issued.token));
    expect(rows[0].tokenHash).not.toBe(issued.token);
  });

  it('rotates a valid token and revokes the previous one', async () => {
    const { rows, prisma } = createFakePrisma();
    const service = new RefreshTokenService(prisma, config);
    const issued = await service.issue('user-1', 'tenant-1', {});

    const rotated = await service.rotate(issued.token, {});

    expect(rotated.userId).toBe('user-1');
    expect(rotated.tenantId).toBe('tenant-1');
    expect(rotated.token).not.toBe(issued.token);
    expect(rows).toHaveLength(2);
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[1].revokedAt).toBeNull();

    await expect(service.rotate(rotated.token, {})).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('detects reuse and revokes the whole family', async () => {
    const { rows, prisma } = createFakePrisma();
    const service = new RefreshTokenService(prisma, config);
    const issued = await service.issue('user-1', 'tenant-1', {});
    await service.rotate(issued.token, {});

    await expect(service.rotate(issued.token, {})).rejects.toBeInstanceOf(RefreshTokenReuseError);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('rejects an expired token', async () => {
    const { rows, prisma } = createFakePrisma();
    const service = new RefreshTokenService(prisma, config);
    const issued = await service.issue('user-1', 'tenant-1', {});
    rows[0].expiresAt = new Date(Date.now() - 1000);

    await expect(service.rotate(issued.token, {})).rejects.toBeInstanceOf(RefreshTokenExpiredError);
  });

  it('rejects an unknown token', async () => {
    const { prisma } = createFakePrisma();
    const service = new RefreshTokenService(prisma, config);

    await expect(service.rotate('unknown-token', {})).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('revokes a token on logout', async () => {
    const { rows, prisma } = createFakePrisma();
    const service = new RefreshTokenService(prisma, config);
    const issued = await service.issue('user-1', 'tenant-1', {});

    await service.revoke(issued.token);

    expect(rows[0].revokedAt).not.toBeNull();
  });
});
