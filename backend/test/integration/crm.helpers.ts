import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Role } from '@prisma/client';
import { AppModule } from '../../src/app.module.js';
import { createFastifyAdapter } from '../../src/common/http/create-fastify-adapter.js';
import { registerHttpPlugins } from '../../src/common/http/register-http-plugins.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { EvolutionClient } from '../../src/modules/whatsapp/evolution/evolution.client.js';

export const TEST_PASSWORD = 'correct-horse-battery';

const passwords = new PasswordService();

export interface TestApp {
  app: NestFastifyApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  evolution?: unknown;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  process.env.JWT_ACCESS_SECRET ??= 'integration-test-access-secret-0000';

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.evolution) {
    builder.overrideProvider(EvolutionClient).useValue(options.evolution);
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await registerHttpPlugins(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    prisma: app.get(PrismaService),
    close: () => app.close(),
  };
}

export interface SeededTenant {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: Role;
  email: string;
  accessToken: string;
}

export interface SeedOptions {
  name: string;
  role?: Role;
}

export async function seedTenant(
  app: NestFastifyApplication,
  prisma: PrismaService,
  options: SeedOptions,
): Promise<SeededTenant> {
  const suffix = randomUUID();
  const passwordHash = await passwords.hash(TEST_PASSWORD);
  const role = options.role ?? 'OWNER';

  const tenant = await prisma.tenant.create({ data: { name: `${options.name} ${suffix}` } });
  const user = await prisma.user.create({
    data: { email: `${options.name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@example.com`, name: options.name, passwordHash },
  });
  const membership = await prisma.tenantUser.create({
    data: { tenantId: tenant.id, userId: user.id, role, active: true },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: user.email, password: TEST_PASSWORD, tenantId: tenant.id },
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    membershipId: membership.id,
    role,
    email: user.email,
    accessToken: login.json().accessToken as string,
  };
}

export async function seedMember(
  app: NestFastifyApplication,
  prisma: PrismaService,
  tenantId: string,
  options: SeedOptions,
): Promise<SeededTenant> {
  const suffix = randomUUID();
  const passwordHash = await passwords.hash(TEST_PASSWORD);
  const role = options.role ?? 'USER';

  const user = await prisma.user.create({
    data: { email: `${options.name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@example.com`, name: options.name, passwordHash },
  });
  const membership = await prisma.tenantUser.create({
    data: { tenantId, userId: user.id, role, active: true },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: user.email, password: TEST_PASSWORD, tenantId },
  });

  return {
    tenantId,
    userId: user.id,
    membershipId: membership.id,
    role,
    email: user.email,
    accessToken: login.json().accessToken as string,
  };
}

export async function cleanupTenants(
  prisma: PrismaService,
  tenants: SeededTenant[],
): Promise<void> {
  const tenantIds = tenants.map((tenant) => tenant.tenantId);
  const userIds = tenants.map((tenant) => tenant.userId);

  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

export function authHeaders(tenant: SeededTenant): Record<string, string> {
  return { authorization: `Bearer ${tenant.accessToken}` };
}
