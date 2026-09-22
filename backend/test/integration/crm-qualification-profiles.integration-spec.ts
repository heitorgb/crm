import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { DEFAULT_PRIVACY_NOTICE } from '../../src/modules/qualification-profiles/qualification-profiles.constants.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

describe('Qualification profiles (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let adminA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    ownerA = await seedTenant(app, prisma, { name: 'Profile Owner A', role: 'OWNER' });
    adminA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Profile Admin A', role: 'ADMIN' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Profile User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Profile Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, adminA, userA, ownerB]);
  });

  function createProfile(tenant: SeededTenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/qualification-profiles',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  describe('CRUD and business rules', () => {
    it('creates a generic profile with all configured fields', async () => {
      const response = await createProfile(ownerA, {
        name: 'Locação de veículos',
        businessContext: 'Locadora que atende motoristas de aplicativo.',
        botName: 'Assistente de Locação',
        initialMessage: 'Olá! Vamos verificar sua elegibilidade.',
        tone: 'Direto',
        objective: 'Confirmar elegibilidade do motorista.',
        requiredInformation: [
          { key: 'cnh_ear', label: 'Possui CNH EAR?', required: true, description: 'Habilitação exigida' },
        ],
        qualificationCriteria: [{ key: 'tem_cnh_ear', label: 'CNH EAR', weight: 100 }],
        disqualificationCriteria: [
          { key: 'sem_cnh_ear', label: 'Não possui CNH EAR', description: 'Critério obrigatório não atendido' },
        ],
        qualificationLevels: [
          { key: 'ELIGIBLE', label: 'Elegível' },
          { key: 'NOT_ELIGIBLE', label: 'Não elegível' },
          { key: 'NEEDS_HUMAN', label: 'Revisão humana' },
        ],
        qualifiedMessage: 'Tudo certo! Você está elegível.',
        disqualifiedMessage: 'Não foi possível seguir: {{criterioNaoAtendido}}.',
        needsHumanMessage: 'Um atendente vai revisar seu caso.',
        dataSensitivityLevel: 'medium',
        isDefault: true,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        name: 'Locação de veículos',
        dataSensitivityLevel: 'medium',
        isDefault: true,
        active: true,
        version: 1,
      });
      expect(response.json().qualificationLevels).toHaveLength(3);
      expect(response.json().disqualifiedMessage).toContain('{{criterioNaoAtendido}}');
      expect(response.json()).not.toHaveProperty('tenantId');
      expect(response.json()).not.toHaveProperty('apiKey');
    });

    it('defaults dataSensitivityLevel to low and fills the privacy notice for active profiles', async () => {
      const response = await createProfile(ownerA, { name: 'Perfil padrão' });

      expect(response.statusCode).toBe(201);
      expect(response.json().dataSensitivityLevel).toBe('low');
      expect(response.json().privacyNoticeText).toBe(DEFAULT_PRIVACY_NOTICE);
    });

    it('keeps the privacy notice empty when the profile is created inactive', async () => {
      const response = await createProfile(ownerA, { name: 'Inativo', active: false });
      expect(response.json().privacyNoticeText).toBeNull();
      expect(response.json().isDefault).toBe(false);
    });

    it('honors an explicit privacy notice', async () => {
      const response = await createProfile(ownerA, {
        name: 'Com aviso',
        privacyNoticeText: 'Aviso customizado do tenant.',
      });
      expect(response.json().privacyNoticeText).toBe('Aviso customizado do tenant.');
    });

    it('updates content and increments the version, but not on activation toggles', async () => {
      const created = await createProfile(ownerA, { name: 'Versionado' });
      const id = created.json().id as string;

      const contentUpdate = await app.inject({
        method: 'PATCH',
        url: `/api/qualification-profiles/${id}`,
        headers: authHeaders(adminA),
        payload: { objective: 'Novo objetivo' },
      });
      expect(contentUpdate.statusCode).toBe(200);
      expect(contentUpdate.json().version).toBe(2);

      const toggle = await app.inject({
        method: 'PATCH',
        url: `/api/qualification-profiles/${id}`,
        headers: authHeaders(adminA),
        payload: { active: false },
      });
      expect(toggle.json().version).toBe(2);
      expect(toggle.json().active).toBe(false);
      expect(toggle.json().isDefault).toBe(false);
    });

    it('enforces a single active default profile per tenant', async () => {
      const first = await createProfile(ownerA, { name: 'Primeiro', isDefault: true });
      const second = await createProfile(ownerA, { name: 'Segundo', isDefault: true });

      expect(first.json().isDefault).toBe(true);
      expect(second.json().isDefault).toBe(true);

      const list = await app.inject({
        method: 'GET',
        url: '/api/qualification-profiles?isDefault=true&active=true',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data).toHaveLength(1);
      expect(list.json().data[0].id).toBe(second.json().id);
    });

    it('deletes a profile scoped to the tenant', async () => {
      const created = await createProfile(ownerA, { name: 'Para excluir' });
      const id = created.json().id as string;

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/qualification-profiles/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(removed.statusCode).toBe(204);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/qualification-profiles/${id}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(404);
    });
  });

  describe('authorization', () => {
    it('allows OWNER and ADMIN to write and forbids USER', async () => {
      const created = await createProfile(adminA, { name: 'Feito pelo admin' });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;

      const forbiddenCreate = await createProfile(userA, { name: 'Feito pelo user' });
      expect(forbiddenCreate.statusCode).toBe(403);

      const forbiddenUpdate = await app.inject({
        method: 'PATCH',
        url: `/api/qualification-profiles/${id}`,
        headers: authHeaders(userA),
        payload: { objective: 'hack' },
      });
      expect(forbiddenUpdate.statusCode).toBe(403);

      const forbiddenDelete = await app.inject({
        method: 'DELETE',
        url: `/api/qualification-profiles/${id}`,
        headers: authHeaders(userA),
      });
      expect(forbiddenDelete.statusCode).toBe(403);

      const allowedRead = await app.inject({
        method: 'GET',
        url: `/api/qualification-profiles/${id}`,
        headers: authHeaders(userA),
      });
      expect(allowedRead.statusCode).toBe(200);
    });
  });

  describe('validation', () => {
    it('rejects invalid enums, nested items and unknown fields', async () => {
      const invalidLevel = await createProfile(ownerA, {
        name: 'Inválido',
        dataSensitivityLevel: 'extreme',
      });
      expect(invalidLevel.statusCode).toBe(400);

      const invalidItem = await createProfile(ownerA, {
        name: 'Inválido',
        qualificationCriteria: [{ label: 'Sem chave' }],
      });
      expect(invalidItem.statusCode).toBe(400);

      const unknownField = await createProfile(ownerA, { name: 'Inválido', tenantId: 'x' });
      expect(unknownField.statusCode).toBe(400);
    });
  });

  describe('pagination and search', () => {
    it('paginates and searches profiles', async () => {
      await createProfile(ownerA, { name: 'Alfa' });
      await createProfile(ownerA, { name: 'Beta' });
      await createProfile(ownerA, { name: 'Gama' });

      const page = await app.inject({
        method: 'GET',
        url: '/api/qualification-profiles?perPage=2&page=1&sort=name&order=asc',
        headers: authHeaders(ownerA),
      });
      expect(page.json().data.map((item: { name: string }) => item.name)).toEqual(['Alfa', 'Beta']);
      expect(page.json().meta).toMatchObject({ total: 3, totalPages: 2 });

      const search = await app.inject({
        method: 'GET',
        url: '/api/qualification-profiles?search=beta',
        headers: authHeaders(ownerA),
      });
      expect(search.json().data).toHaveLength(1);
      expect(search.json().data[0].name).toBe('Beta');
    });
  });

  describe('tenant isolation', () => {
    it('never exposes another tenant profile', async () => {
      const profileB = await createProfile(ownerB, { name: 'Só do B' });
      const idB = profileB.json().id as string;

      await createProfile(ownerA, { name: 'Só do A' });

      const listA = await app.inject({
        method: 'GET',
        url: '/api/qualification-profiles',
        headers: authHeaders(ownerA),
      });
      expect(listA.json().data.map((item: { name: string }) => item.name)).toEqual(['Só do A']);

      const readAsA = await app.inject({
        method: 'GET',
        url: `/api/qualification-profiles/${idB}`,
        headers: authHeaders(ownerA),
      });
      expect(readAsA.statusCode).toBe(404);

      const updateAsA = await app.inject({
        method: 'PATCH',
        url: `/api/qualification-profiles/${idB}`,
        headers: authHeaders(ownerA),
        payload: { name: 'hacked' },
      });
      expect(updateAsA.statusCode).toBe(404);

      const deleteAsA = await app.inject({
        method: 'DELETE',
        url: `/api/qualification-profiles/${idB}`,
        headers: authHeaders(ownerA),
      });
      expect(deleteAsA.statusCode).toBe(404);

      const untouched = await prisma.qualificationProfile.findUnique({ where: { id: idB } });
      expect(untouched?.name).toBe('Só do B');
    });

    it('never lets a default profile of one tenant affect another', async () => {
      await createProfile(ownerA, { name: 'Default A', isDefault: true });
      await createProfile(ownerB, { name: 'Default B', isDefault: true });

      const defaultsA = await prisma.qualificationProfile.findMany({
        where: { tenantId: ownerA.tenantId, isDefault: true },
      });
      const defaultsB = await prisma.qualificationProfile.findMany({
        where: { tenantId: ownerB.tenantId, isDefault: true },
      });

      expect(defaultsA).toHaveLength(1);
      expect(defaultsA[0].name).toBe('Default A');
      expect(defaultsB).toHaveLength(1);
      expect(defaultsB[0].name).toBe('Default B');
    });
  });
});
