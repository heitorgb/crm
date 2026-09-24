import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env first.');
  process.exit(1);
}

const SEED = {
  tenantName: 'OrderUp Demo',
  email: 'admin@orderup.local',
  password: 'admin12345',
  userName: 'Administrador Demo',
  role: 'OWNER',
};

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const passwordHash = await hash(SEED.password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const tenant =
    (await prisma.tenant.findFirst({ where: { name: SEED.tenantName } })) ??
    (await prisma.tenant.create({ data: { name: SEED.tenantName } }));

  const user = await prisma.user.upsert({
    where: { email: SEED.email },
    update: { passwordHash, name: SEED.userName, active: true },
    create: { email: SEED.email, passwordHash, name: SEED.userName, active: true },
  });

  await prisma.tenantUser.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    update: { role: SEED.role, active: true },
    create: { tenantId: tenant.id, userId: user.id, role: SEED.role, active: true },
  });

  console.log('\nSeed concluído. Acesse com:');
  console.log(`  Tenant: ${SEED.tenantName}`);
  console.log(`  E-mail: ${SEED.email}`);
  console.log(`  Senha:  ${SEED.password}\n`);
}

main()
  .catch((error) => {
    console.error('Falha ao executar o seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
