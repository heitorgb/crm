import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

describe('Sales module (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
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
    ownerA = await seedTenant(app, prisma, { name: 'Sales Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Sales User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Sales Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  async function createPipeline(
    tenant: SeededTenant,
    name: string,
    stages: string[],
  ): Promise<{ pipelineId: string; stageIds: string[] }> {
    const pipelineResponse = await app.inject({
      method: 'POST',
      url: '/api/pipelines',
      headers: authHeaders(tenant),
      payload: { name },
    });
    const pipelineId = pipelineResponse.json().id as string;

    const stageIds: string[] = [];
    for (const stageName of stages) {
      const stageResponse = await app.inject({
        method: 'POST',
        url: `/api/pipelines/${pipelineId}/stages`,
        headers: authHeaders(tenant),
        payload: { name: stageName },
      });
      stageIds.push(stageResponse.json().id as string);
    }

    return { pipelineId, stageIds };
  }

  describe('pipelines and stages', () => {
    it('creates a pipeline with ordered stages and rejects duplicated names', async () => {
      const { pipelineId, stageIds } = await createPipeline(ownerA, 'Comercial', [
        'Novo Lead',
        'Primeiro Contato',
        'Proposta',
      ]);

      expect(stageIds).toHaveLength(3);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/pipelines/${pipelineId}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.json().stages.map((stage: { name: string }) => stage.name)).toEqual([
        'Novo Lead',
        'Primeiro Contato',
        'Proposta',
      ]);
      expect(detail.json().stages.map((stage: { position: number }) => stage.position)).toEqual([
        0, 1, 2,
      ]);

      const duplicated = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: authHeaders(ownerA),
        payload: { name: 'Comercial' },
      });
      expect(duplicated.statusCode).toBe(409);
      expect(duplicated.json().code).toBe('PIPELINE_NAME_CONFLICT');
    });

    it('rejects conflicting stage positions', async () => {
      const { pipelineId, stageIds } = await createPipeline(ownerA, 'Posições', ['A', 'B']);

      const conflict = await app.inject({
        method: 'PATCH',
        url: `/api/pipelines/${pipelineId}/stages/${stageIds[1]}`,
        headers: authHeaders(ownerA),
        payload: { position: 0 },
      });

      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe('PIPELINE_STAGE_POSITION_CONFLICT');
    });

    it('validates stage belongs to the pipeline and tenant', async () => {
      const pipelineA = await createPipeline(ownerA, 'A', ['A1']);
      const pipelineB = await createPipeline(ownerB, 'B', ['B1']);

      const foreignUpdate = await app.inject({
        method: 'PATCH',
        url: `/api/pipelines/${pipelineA.pipelineId}/stages/${pipelineB.stageIds[0]}`,
        headers: authHeaders(ownerA),
        payload: { name: 'hacked' },
      });
      expect(foreignUpdate.statusCode).toBe(404);
    });

    it('restricts pipeline deletion to OWNER/ADMIN', async () => {
      const { pipelineId } = await createPipeline(ownerA, 'Delete', ['A']);

      const forbidden = await app.inject({
        method: 'DELETE',
        url: `/api/pipelines/${pipelineId}`,
        headers: authHeaders(userA),
      });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await app.inject({
        method: 'DELETE',
        url: `/api/pipelines/${pipelineId}`,
        headers: authHeaders(ownerA),
      });
      expect(allowed.statusCode).toBe(204);
    });
  });

  describe('leads', () => {
    it('creates, lists, searches and updates leads', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerA),
        payload: { name: 'Joao Silva', phone: '+5511999990000', source: 'site' },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ name: 'Joao Silva', status: 'NEW' });
      expect(created.json()).not.toHaveProperty('tenantId');

      const list = await app.inject({
        method: 'GET',
        url: '/api/leads?search=joao',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data).toHaveLength(1);

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/leads/${created.json().id}`,
        headers: authHeaders(ownerA),
        payload: { status: 'NEEDS_HUMAN' },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().status).toBe('NEEDS_HUMAN');
    });

    it('requires a name or phone and rejects unknown fields', async () => {
      const missing = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerA),
        payload: { source: 'site' },
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().code).toBe('LEAD_IDENTIFIER_REQUIRED');

      const unknown = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerA),
        payload: { name: 'Ok', tenantId: 'x' },
      });
      expect(unknown.statusCode).toBe(400);
    });

    it('rejects a duplicated phone within the tenant but allows it across tenants', async () => {
      const phone = '+5511988887777';
      const first = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerA),
        payload: { name: 'A', phone },
      });
      expect(first.statusCode).toBe(201);

      const duplicated = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerA),
        payload: { name: 'A2', phone },
      });
      expect(duplicated.statusCode).toBe(409);

      const otherTenant = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerB),
        payload: { name: 'B', phone },
      });
      expect(otherTenant.statusCode).toBe(201);
    });

    it('never exposes another tenant lead', async () => {
      const leadB = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerB),
        payload: { name: 'Only B', phone: '+5511900000000' },
      });

      const read = await app.inject({
        method: 'GET',
        url: `/api/leads/${leadB.json().id}`,
        headers: authHeaders(ownerA),
      });
      expect(read.statusCode).toBe(404);

      const listA = await app.inject({
        method: 'GET',
        url: '/api/leads',
        headers: authHeaders(ownerA),
      });
      expect(listA.json().data).toHaveLength(0);
    });
  });

  describe('deals', () => {
    it('creates a deal on the first stage when stageId is omitted', async () => {
      const { pipelineId, stageIds } = await createPipeline(ownerA, 'Vendas', ['Novo', 'Proposta']);

      const created = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'Deal 1', pipelineId, value: 1000.5 },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        title: 'Deal 1',
        pipelineId,
        stageId: stageIds[0],
        status: 'OPEN',
        value: '1000.5',
      });
    });

    it('rejects a pipeline from another tenant and a stage from another pipeline', async () => {
      const pipelineA = await createPipeline(ownerA, 'A', ['A1']);
      await createPipeline(ownerA, 'A2', ['A2-1']);
      const pipelineB = await createPipeline(ownerB, 'B', ['B1']);

      const foreignPipeline = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'X', pipelineId: pipelineB.pipelineId },
      });
      expect(foreignPipeline.statusCode).toBe(404);

      const mismatched = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'X', pipelineId: pipelineA.pipelineId, stageId: pipelineB.stageIds[0] },
      });
      expect(mismatched.statusCode).toBe(404);
    });

    it('moves a deal between stages of the same pipeline', async () => {
      const { pipelineId, stageIds } = await createPipeline(ownerA, 'Mov', ['Novo', 'Ganho']);
      const created = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'Mover', pipelineId },
      });

      const moved = await app.inject({
        method: 'PATCH',
        url: `/api/deals/${created.json().id}/stage`,
        headers: authHeaders(ownerA),
        payload: { stageId: stageIds[1] },
      });

      expect(moved.statusCode).toBe(200);
      expect(moved.json().stageId).toBe(stageIds[1]);
    });

    it('never allows moving a deal to a stage of another tenant or pipeline', async () => {
      const pipelineA = await createPipeline(ownerA, 'A', ['A1', 'A2']);
      const pipelineA2 = await createPipeline(ownerA, 'A2', ['A2-1']);
      const pipelineB = await createPipeline(ownerB, 'B', ['B1']);

      const deal = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'Deal A', pipelineId: pipelineA.pipelineId },
      });
      const dealId = deal.json().id as string;

      const toOtherTenant = await app.inject({
        method: 'PATCH',
        url: `/api/deals/${dealId}/stage`,
        headers: authHeaders(ownerA),
        payload: { stageId: pipelineB.stageIds[0] },
      });
      expect(toOtherTenant.statusCode).toBe(404);

      const toOtherPipeline = await app.inject({
        method: 'PATCH',
        url: `/api/deals/${dealId}/stage`,
        headers: authHeaders(ownerA),
        payload: { stageId: pipelineA2.stageIds[0] },
      });
      expect(toOtherPipeline.statusCode).toBe(400);
      expect(toOtherPipeline.json().code).toBe('DEAL_STAGE_PIPELINE_MISMATCH');

      const untouched = await prisma.deal.findUnique({ where: { id: dealId } });
      expect(untouched?.stageId).toBe(pipelineA.stageIds[0]);
    });

    it('returns a board grouped by stage with counts', async () => {
      const { pipelineId } = await createPipeline(ownerA, 'Board', ['Novo', 'Proposta']);

      await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'B1', pipelineId },
      });
      await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'B2', pipelineId },
      });

      const board = await app.inject({
        method: 'GET',
        url: `/api/deals/board?pipelineId=${pipelineId}`,
        headers: authHeaders(ownerA),
      });

      expect(board.statusCode).toBe(200);
      expect(board.json().stages).toHaveLength(2);
      expect(board.json().stages[0].dealCount).toBe(2);
      expect(board.json().stages[0].deals).toHaveLength(2);
      expect(board.json().stages[1].dealCount).toBe(0);
    });

    it('rejects relations from another tenant', async () => {
      const { pipelineId } = await createPipeline(ownerA, 'Rel', ['A']);
      const foreignCustomer = await prisma.customer.create({
        data: { tenantId: ownerB.tenantId, name: 'Foreign customer' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'X', pipelineId, customerId: foreignCustomer.id },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('DEAL_RELATION_NOT_FOUND');
    });

    it('restricts deal deletion to OWNER/ADMIN', async () => {
      const { pipelineId } = await createPipeline(ownerA, 'Del', ['A']);
      const created = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'Del', pipelineId },
      });

      const forbidden = await app.inject({
        method: 'DELETE',
        url: `/api/deals/${created.json().id}`,
        headers: authHeaders(userA),
      });
      expect(forbidden.statusCode).toBe(403);
    });
  });

  describe('tasks', () => {
    it('creates, updates and completes a task', async () => {
      const lead = await app.inject({
        method: 'POST',
        url: '/api/leads',
        headers: authHeaders(ownerA),
        payload: { name: 'Tarefa Lead' },
      });

      const created = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeaders(ownerA),
        payload: {
          title: 'Ligar para o lead',
          priority: 'HIGH',
          leadId: lead.json().id,
          ownerId: ownerA.membershipId,
        },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status: 'PENDING', priority: 'HIGH' });
      expect(created.json().leadName).toBe('Tarefa Lead');

      const done = await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${created.json().id}`,
        headers: authHeaders(ownerA),
        payload: { status: 'DONE' },
      });
      expect(done.statusCode).toBe(200);
      expect(done.json().completedAt).not.toBeNull();
    });

    it('rejects relations from another tenant', async () => {
      const foreignLead = await prisma.lead.create({
        data: { tenantId: ownerB.tenantId, name: 'Foreign' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeaders(ownerA),
        payload: { title: 'X', leadId: foreignLead.id },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('TASK_RELATION_NOT_FOUND');
    });
  });

  describe('activities', () => {
    it('records and isolates commercial history', async () => {
      const { pipelineId } = await createPipeline(ownerA, 'Hist', ['A']);
      const deal = await app.inject({
        method: 'POST',
        url: '/api/deals',
        headers: authHeaders(ownerA),
        payload: { title: 'Histórico', pipelineId },
      });
      const dealId = deal.json().id as string;

      const activities = await app.inject({
        method: 'GET',
        url: `/api/activities?entity=deal&entityId=${dealId}`,
        headers: authHeaders(ownerA),
      });

      expect(activities.statusCode).toBe(200);
      expect(activities.json().data.some((item: { action: string }) => item.action === 'created')).toBe(
        true,
      );

      const fromB = await app.inject({
        method: 'GET',
        url: '/api/activities',
        headers: authHeaders(ownerB),
      });
      expect(fromB.json().data).toHaveLength(0);
    });
  });
});
