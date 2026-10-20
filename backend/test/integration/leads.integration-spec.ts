import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

describe('Leads pipeline (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => context.close());

  beforeEach(async () => {
    tenantA = await seedTenant(app, prisma, { name: 'Leads A' });
    tenantB = await seedTenant(app, prisma, { name: 'Leads B' });
  });

  afterEach(async () => cleanupTenants(prisma, [tenantA, tenantB]));

  async function createPipeline(tenant: SeededTenant) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/leads/pipelines',
      headers: authHeaders(tenant),
      payload: { name: 'Pipeline principal' },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; stages: Array<{ id: string; kind: string }> };
  }

  async function createContact(tenant: SeededTenant, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: authHeaders(tenant),
      payload: { name, phone: name === 'Contato A' ? '5511999990001' : '5511999990002' },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string };
  }

  it('creates, lists and moves a lead while deriving won status from the stage', async () => {
    const pipeline = await createPipeline(tenantA);
    const contact = await createContact(tenantA, 'Contato A');
    const tag = await prisma.tag.create({
      data: { tenantId: tenantA.tenantId, name: 'Prioridade', color: '#EF4444' },
    });
    const openStage = pipeline.stages.find((stage) => stage.kind === 'OPEN');
    const wonStage = pipeline.stages.find((stage) => stage.kind === 'WON');

    const created = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: authHeaders(tenantA),
      payload: {
        pipelineId: pipeline.id,
        stageId: openStage?.id,
        contactId: contact.id,
        title: 'Implantação OrderUp',
        source: 'WhatsApp',
        valueCents: 250000,
        tagIds: [tag.id],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'OPEN',
      valueCents: 250000,
      tags: [{ id: tag.id, name: 'Prioridade', color: '#EF4444' }],
    });

    const board = await app.inject({
      method: 'GET',
      url: `/api/leads/board?pipelineId=${pipeline.id}`,
      headers: authHeaders(tenantA),
    });
    expect(board.statusCode).toBe(200);
    expect(board.json().stages.flatMap((stage: { leads: unknown[] }) => stage.leads)).toHaveLength(1);

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/leads/${created.json().id}/stage`,
      headers: authHeaders(tenantA),
      payload: { stageId: wonStage?.id },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().status).toBe('WON');
    expect(moved.json().closedAt).toBeTruthy();
  });

  it('rejects contact, owner and stage identifiers from another tenant', async () => {
    const pipelineA = await createPipeline(tenantA);
    const pipelineB = await createPipeline(tenantB);
    const contactA = await createContact(tenantA, 'Contato A');
    const contactB = await createContact(tenantB, 'Contato B');
    const foreignTag = await prisma.tag.create({
      data: { tenantId: tenantB.tenantId, name: 'Somente B' },
    });

    const foreignContact = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: authHeaders(tenantA),
      payload: {
        pipelineId: pipelineA.id,
        stageId: pipelineA.stages[0]?.id,
        contactId: contactB.id,
        title: 'Não permitido',
      },
    });
    expect(foreignContact.statusCode).toBe(404);
    expect(foreignContact.json().code).toBe('LEAD_CONTACT_NOT_FOUND');

    const foreignStage = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: authHeaders(tenantA),
      payload: {
        pipelineId: pipelineA.id,
        stageId: pipelineB.stages[0]?.id,
        contactId: contactA.id,
        title: 'Não permitido',
      },
    });
    expect(foreignStage.statusCode).toBe(404);
    expect(foreignStage.json().code).toBe('LEAD_STAGE_NOT_FOUND');

    const foreignOwner = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: authHeaders(tenantA),
      payload: {
        pipelineId: pipelineA.id,
        stageId: pipelineA.stages[0]?.id,
        contactId: contactA.id,
        ownerId: tenantB.membershipId,
        title: 'Não permitido',
      },
    });
    expect(foreignOwner.statusCode).toBe(404);
    expect(foreignOwner.json().code).toBe('LEAD_OWNER_NOT_FOUND');

    const tagFromAnotherTenant = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: authHeaders(tenantA),
      payload: {
        pipelineId: pipelineA.id,
        stageId: pipelineA.stages[0]?.id,
        contactId: contactA.id,
        title: 'NÃ£o permitido',
        tagIds: [foreignTag.id],
      },
    });
    expect(tagFromAnotherTenant.statusCode).toBe(404);
    expect(tagFromAnotherTenant.json().code).toBe('LEAD_TAG_NOT_FOUND');
  });

  it('never exposes another tenant leads on the board', async () => {
    const pipelineA = await createPipeline(tenantA);
    const pipelineB = await createPipeline(tenantB);
    const contactB = await createContact(tenantB, 'Contato B');

    await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: authHeaders(tenantB),
      payload: {
        pipelineId: pipelineB.id,
        stageId: pipelineB.stages[0]?.id,
        contactId: contactB.id,
        title: 'Lead exclusivo B',
      },
    });

    const boardA = await app.inject({
      method: 'GET',
      url: `/api/leads/board?pipelineId=${pipelineA.id}`,
      headers: authHeaders(tenantA),
    });
    expect(boardA.statusCode).toBe(200);
    expect(boardA.json().stages.flatMap((stage: { leads: unknown[] }) => stage.leads)).toHaveLength(0);
  });
});
