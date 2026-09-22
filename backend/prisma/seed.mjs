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

  await seedQualificationProfile(tenant.id);
  await seedPipeline(tenant.id);

  console.log('\nSeed concluído. Acesse com:');
  console.log(`  Tenant: ${SEED.tenantName}`);
  console.log(`  E-mail: ${SEED.email}`);
  console.log(`  Senha:  ${SEED.password}\n`);
}

async function seedQualificationProfile(tenantId) {
  const name = 'Perfil padrão';
  const existing = await prisma.qualificationProfile.findFirst({ where: { tenantId, name } });
  if (existing) {
    return;
  }

  await prisma.qualificationProfile.create({
    data: {
      tenantId,
      name,
      description: 'Perfil inicial criado pelo seed para o bot de qualificação.',
      botName: 'Assistente OrderUp',
      initialMessage: 'Olá! Vou fazer algumas perguntas rápidas para entender sua necessidade.',
      privacyNoticeText:
        'Usamos os dados que você compartilhar aqui para avaliar seu interesse e dar seguimento ao atendimento. Você pode pedir para falar com uma pessoa a qualquer momento.',
      tone: 'Consultivo',
      objective: 'Entender a necessidade, o orçamento e o prazo antes de encaminhar ao time.',
      requiredInformation: [
        { key: 'need', label: 'Necessidade', required: true },
        { key: 'budget', label: 'Orçamento', required: true },
        { key: 'timing', label: 'Prazo', required: true },
      ],
      qualificationCriteria: [
        { key: 'budget_fit', label: 'Orçamento compatível', weight: 40 },
        { key: 'timing_fit', label: 'Prazo viável', weight: 30 },
      ],
      disqualificationCriteria: [{ key: 'out_of_scope', label: 'Fora do escopo de atuação' }],
      qualificationLevels: [
        { key: 'HOT', label: 'Quente' },
        { key: 'WARM', label: 'Morno' },
        { key: 'COLD', label: 'Frio' },
      ],
      qualifiedMessage: 'Perfeito! Vou encaminhar suas informações para um especialista.',
      disqualifiedMessage: 'No momento não conseguimos seguir com o atendimento.',
      needsHumanMessage: 'Vou chamar uma pessoa do time para continuar a conversa.',
      isDefault: true,
      active: true,
    },
  });
}

async function seedPipeline(tenantId) {
  const name = 'Comercial';
  const pipeline = await prisma.pipeline.upsert({
    where: { tenantId_name: { tenantId, name } },
    update: {},
    create: { tenantId, name, description: 'Funil comercial padrão', active: true },
  });

  const stages = [
    'Novo Lead',
    'Primeiro Contato',
    'Reunião',
    'Proposta',
    'Negociação',
    'Fechado',
  ];

  for (const [position, stageName] of stages.entries()) {
    const existing = await prisma.pipelineStage.findFirst({
      where: { pipelineId: pipeline.id, name: stageName },
    });
    if (existing) {
      continue;
    }

    await prisma.pipelineStage.create({
      data: { tenantId, pipelineId: pipeline.id, name: stageName, position },
    });
  }
}

main()
  .catch((error) => {
    console.error('Falha ao executar o seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
