import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../../src/config/env.validation.js';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';

describe('PrismaService (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to PostgreSQL', async () => {
    const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;

    expect(result[0]?.ok).toBe(1);
  });

  it('has the base multi-tenancy tables migrated', async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    expect(tables.map((table) => table.table_name)).toEqual(
      expect.arrayContaining(['tenants', 'users', 'tenant_users']),
    );
  });
});
