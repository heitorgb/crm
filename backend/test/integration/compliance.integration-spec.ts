import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { RetentionService } from '../../src/modules/compliance/retention.service.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

describe('LGPD compliance (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let retention: RetentionService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
    retention = app.get(RetentionService);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    ownerA = await seedTenant(app, prisma, { name: 'Lgpd Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Lgpd User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Lgpd Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  async function seedLeadTree(tenant: SeededTenant, options: { legalHold?: boolean } = {}) {
    const instance = await prisma.whatsAppInstance.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Instância',
        instanceName: `lgpd-${randomUUID()}`,
      },
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Titular Teste',
        phone: `+55119${Math.floor(10000000 + Math.random() * 89999999)}`,
        email: 'titular@example.com',
        legalHold: options.legalHold ?? false,
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.tenantId,
        whatsappInstanceId: instance.id,
        leadId: lead.id,
        externalContactId: `${randomUUID()}@s.whatsapp.net`,
        status: 'CLOSED',
      },
    });

    await prisma.message.create({
      data: {
        tenantId: tenant.tenantId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        content: 'Meu nome é Titular e quero um orçamento',
        externalMessageId: `msg-${randomUUID()}`,
      },
    });

    const profile = await prisma.qualificationProfile.create({
      data: { tenantId: tenant.tenantId, name: `perfil-${randomUUID()}`, active: true },
    });
    const session = await prisma.leadQualificationSession.create({
      data: {
        tenantId: tenant.tenantId,
        leadId: lead.id,
        profileId: profile.id,
        profileVersion: 1,
        status: 'DISQUALIFIED',
        collectedData: { budget: '0' },
        transcript: [{ role: 'LEAD', content: 'Meu nome é Titular', at: '' }],
      },
    });
    await prisma.leadAnalysis.create({
      data: {
        tenantId: tenant.tenantId,
        leadId: lead.id,
        sessionId: session.id,
        profileId: profile.id,
        profileVersion: 1,
        provider: 'fake',
        model: 'fake',
        outcome: 'DISQUALIFIED',
        score: 10,
        qualificationLevel: 'COLD',
        summary: 'Fora do perfil',
        qualificationReasons: ['Sem orçamento'],
      },
    });

    return { lead, conversation, session };
  }

  describe('DPO and legal acceptance', () => {
    it('configures the DPO and exposes it publicly with fallback', async () => {
      const updated = await app.inject({
        method: 'PUT',
        url: '/api/compliance/settings/dpo',
        headers: authHeaders(ownerA),
        payload: { name: 'Encarregado A', email: 'dpo@example.com' },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().dpo).toMatchObject({
        name: 'Encarregado A',
        email: 'dpo@example.com',
        configuredByTenant: true,
      });

      const publicA = await app.inject({
        method: 'GET',
        url: `/api/compliance/tenants/${ownerA.tenantId}/dpo`,
      });
      expect(publicA.statusCode).toBe(200);
      expect(publicA.json().dpo.email).toBe('dpo@example.com');

      const publicB = await app.inject({
        method: 'GET',
        url: `/api/compliance/tenants/${ownerB.tenantId}/dpo`,
      });
      expect(publicB.json().dpo.configuredByTenant).toBe(false);
      expect(publicB.json().dpo.email).toContain('@');
      expect(publicB.json().controller).toBe('tenant');
    });

    it('validates the DPO email and restricts configuration to OWNER/ADMIN', async () => {
      const invalid = await app.inject({
        method: 'PUT',
        url: '/api/compliance/settings/dpo',
        headers: authHeaders(ownerA),
        payload: { email: 'not-an-email' },
      });
      expect(invalid.statusCode).toBe(400);

      const forbidden = await app.inject({
        method: 'PUT',
        url: '/api/compliance/settings/dpo',
        headers: authHeaders(userA),
        payload: { email: 'x@example.com' },
      });
      expect(forbidden.statusCode).toBe(403);
    });

    it('records Terms and DPA acceptance with version and date', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/compliance/settings/legal-acceptance',
        headers: authHeaders(ownerA),
        payload: { termsVersion: '2026-02', dpaVersion: '2026-02' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().legal.tenant.termsVersion).toBe('2026-02');
      expect(response.json().legal.tenant.termsAcceptedAt).not.toBeNull();
      expect(response.json().legal.tenant.dpaAcceptedAt).not.toBeNull();
    });
  });

  describe('data subject rights', () => {
    it('returns access data scoped to the tenant', async () => {
      const { lead } = await seedLeadTree(ownerA);

      const response = await app.inject({
        method: 'GET',
        url: `/api/compliance/subjects/leads/${lead.id}/access`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().lead.email).toBe('titular@example.com');
      expect(response.json().conversations[0].messages).toHaveLength(1);

      const foreign = await app.inject({
        method: 'GET',
        url: `/api/compliance/subjects/leads/${lead.id}/access`,
        headers: authHeaders(ownerB),
      });
      expect(foreign.statusCode).toBe(404);

      const forbidden = await app.inject({
        method: 'GET',
        url: `/api/compliance/subjects/leads/${lead.id}/access`,
        headers: authHeaders(userA),
      });
      expect(forbidden.statusCode).toBe(403);
    });

    it('exports structured data for portability', async () => {
      const { lead } = await seedLeadTree(ownerA);
      const response = await app.inject({
        method: 'GET',
        url: `/api/compliance/subjects/leads/${lead.id}/export`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().format).toBe('json');
      expect(response.json().data.lead.id).toBe(lead.id);
    });

    it('rectifies data and records the request', async () => {
      const { lead } = await seedLeadTree(ownerA);

      const response = await app.inject({
        method: 'POST',
        url: `/api/compliance/subjects/leads/${lead.id}/rectify`,
        headers: authHeaders(ownerA),
        payload: { name: 'Nome Corrigido', email: 'corrigido@example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().lead.name).toBe('Nome Corrigido');

      const requests = await prisma.dataSubjectRequest.findMany({
        where: { tenantId: ownerA.tenantId, type: 'RECTIFICATION' },
      });
      expect(requests).toHaveLength(1);
    });

    it('erases by anonymizing the whole subject tree and never touches another tenant', async () => {
      const { lead, conversation } = await seedLeadTree(ownerA);
      const foreign = await seedLeadTree(ownerB);

      const response = await app.inject({
        method: 'POST',
        url: `/api/compliance/subjects/leads/${lead.id}/erase`,
        headers: authHeaders(ownerA),
        payload: { confirm: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().leadId).toBe(lead.id);

      const anonymized = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(anonymized?.name).toBeNull();
      expect(anonymized?.phone).toBeNull();
      expect(anonymized?.anonymizedAt).not.toBeNull();

      const messages = await prisma.message.findMany({ where: { conversationId: conversation.id } });
      expect(messages.every((message) => message.content === null)).toBe(true);

      const analysis = await prisma.leadAnalysis.findFirst({ where: { leadId: lead.id } });
      expect(analysis?.summary).toBe('Dados pessoais anonimizados');

      const foreignLead = await prisma.lead.findUnique({ where: { id: foreign.lead.id } });
      expect(foreignLead?.name).toBe('Titular Teste');

      const requests = await prisma.dataSubjectRequest.findMany({
        where: { tenantId: ownerA.tenantId, type: 'ERASURE' },
      });
      expect(requests).toHaveLength(1);
    });

    it('refuses erasure without confirmation and when under legal hold', async () => {
      const { lead } = await seedLeadTree(ownerA);

      const noConfirm = await app.inject({
        method: 'POST',
        url: `/api/compliance/subjects/leads/${lead.id}/erase`,
        headers: authHeaders(ownerA),
        payload: { confirm: false },
      });
      expect(noConfirm.statusCode).toBe(400);

      await prisma.lead.update({ where: { id: lead.id }, data: { legalHold: true } });
      const held = await app.inject({
        method: 'POST',
        url: `/api/compliance/subjects/leads/${lead.id}/erase`,
        headers: authHeaders(ownerA),
        payload: { confirm: true },
      });
      expect(held.statusCode).toBe(409);
      expect(held.json().code).toBe('LEGAL_HOLD_ACTIVE');
    });

    it('records consent revocation and opposition', async () => {
      const { lead } = await seedLeadTree(ownerA);

      const revocation = await app.inject({
        method: 'POST',
        url: `/api/compliance/subjects/leads/${lead.id}/consent-revocation`,
        headers: authHeaders(ownerA),
        payload: { reason: 'Pedido do titular' },
      });
      expect(revocation.statusCode).toBe(200);
      expect(revocation.json().consentRevokedAt).not.toBeNull();

      const opposition = await app.inject({
        method: 'POST',
        url: `/api/compliance/subjects/leads/${lead.id}/opposition`,
        headers: authHeaders(ownerA),
        payload: {},
      });
      expect(opposition.statusCode).toBe(200);
      expect(opposition.json().oppositionAt).not.toBeNull();

      const types = await prisma.dataSubjectRequest.findMany({
        where: { tenantId: ownerA.tenantId },
        select: { type: true },
      });
      expect(types.map((item) => item.type).sort()).toEqual(['CONSENT_REVOCATION', 'OPPOSITION']);
    });
  });

  describe('automated decision review (art. 20)', () => {
    async function seedResolvedSession(tenant: SeededTenant) {
      const { lead, session } = await seedLeadTree(tenant);
      await prisma.leadQualificationSession.update({
        where: { id: session.id },
        data: { status: 'DISQUALIFIED' },
      });
      return { lead, sessionId: session.id };
    }

    it('opens an immediate handoff and records the review', async () => {
      const { sessionId } = await seedResolvedSession(ownerA);

      const response = await app.inject({
        method: 'POST',
        url: `/api/compliance/reviews/sessions/${sessionId}/request`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().session).toMatchObject({
        status: 'NEEDS_HUMAN',
        reviewRequested: true,
      });
      expect(response.json().analysis.qualificationReasons).toEqual(['Sem orçamento']);

      const tickets = await prisma.ticket.findMany({ where: { tenantId: ownerA.tenantId } });
      expect(tickets).toHaveLength(1);

      const pending = await prisma.dataSubjectRequest.findMany({
        where: { tenantId: ownerA.tenantId, type: 'AUTOMATED_REVIEW', status: 'PENDING' },
      });
      expect(pending).toHaveLength(1);
    });

    it('records the review outcome and reverses the decision', async () => {
      const { lead, sessionId } = await seedResolvedSession(ownerA);

      await app.inject({
        method: 'POST',
        url: `/api/compliance/reviews/sessions/${sessionId}/request`,
        headers: authHeaders(ownerA),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/compliance/reviews/sessions/${sessionId}/resolve`,
        headers: authHeaders(ownerA),
        payload: { outcome: 'REVERSED', notes: 'Atendente reavaliou' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().session.reviewOutcome).toBe('REVERSED');

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.status).toBe('QUALIFIED_WAITING_DIGEST');

      const resolved = await prisma.dataSubjectRequest.findMany({
        where: { tenantId: ownerA.tenantId, type: 'AUTOMATED_REVIEW', status: 'COMPLETED' },
      });
      expect(resolved).toHaveLength(1);
    });
  });

  describe('retention job', () => {
    it('anonymizes only the target tenant and respects legal hold', async () => {
      const instanceA = await prisma.whatsAppInstance.create({
        data: { tenantId: ownerA.tenantId, name: 'A', instanceName: `ret-a-${randomUUID()}` },
      });
      const leadA = await prisma.lead.create({
        data: { tenantId: ownerA.tenantId, name: 'Antigo A', status: 'NEW' },
      });
      const conversationA = await prisma.conversation.create({
        data: {
          tenantId: ownerA.tenantId,
          whatsappInstanceId: instanceA.id,
          leadId: leadA.id,
          externalContactId: `${randomUUID()}@s.whatsapp.net`,
          status: 'CLOSED',
          closedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      });
      const messageA = await prisma.message.create({
        data: {
          tenantId: ownerA.tenantId,
          conversationId: conversationA.id,
          direction: 'INBOUND',
          content: 'conteúdo antigo A',
        },
      });

      const instanceB = await prisma.whatsAppInstance.create({
        data: { tenantId: ownerB.tenantId, name: 'B', instanceName: `ret-b-${randomUUID()}` },
      });
      const leadB = await prisma.lead.create({
        data: { tenantId: ownerB.tenantId, name: 'Antigo B', status: 'NEW' },
      });
      const conversationB = await prisma.conversation.create({
        data: {
          tenantId: ownerB.tenantId,
          whatsappInstanceId: instanceB.id,
          leadId: leadB.id,
          externalContactId: `${randomUUID()}@s.whatsapp.net`,
          status: 'CLOSED',
          closedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      });
      const messageB = await prisma.message.create({
        data: {
          tenantId: ownerB.tenantId,
          conversationId: conversationB.id,
          direction: 'INBOUND',
          content: 'conteúdo antigo B',
        },
      });

      // Retention lead: old updated_at, no conversations.
      const oldLead = await prisma.lead.create({
        data: { tenantId: ownerA.tenantId, name: 'Lead Retenção', phone: `+55119${Date.now() % 100000000}` },
      });
      await prisma.$executeRaw`UPDATE "leads" SET "updated_at" = ${new Date('2020-01-01T00:00:00.000Z')} WHERE "id" = ${oldLead.id}::uuid`;

      const held = await prisma.conversation.create({
        data: {
          tenantId: ownerA.tenantId,
          whatsappInstanceId: instanceA.id,
          externalContactId: `${randomUUID()}@s.whatsapp.net`,
          status: 'CLOSED',
          closedAt: new Date('2020-01-01T00:00:00.000Z'),
          legalHold: true,
        },
      });
      const heldMessage = await prisma.message.create({
        data: { tenantId: ownerA.tenantId, conversationId: held.id, direction: 'INBOUND', content: 'sob hold' },
      });

      const result = await retention.expunge(ownerA.tenantId, new Date());

      expect(result.conversations).toBeGreaterThanOrEqual(1);
      expect(result.leads).toBe(1);

      const messageAResult = await prisma.message.findUnique({ where: { id: messageA.id } });
      expect(messageAResult?.content).toBeNull();

      const leadAResult = await prisma.lead.findUnique({ where: { id: leadA.id } });
      expect(leadAResult?.name).toBe('Antigo A');

      const oldLeadResult = await prisma.lead.findUnique({ where: { id: oldLead.id } });
      expect(oldLeadResult?.name).toBeNull();
      expect(oldLeadResult?.anonymizedAt).not.toBeNull();

      const messageBResult = await prisma.message.findUnique({ where: { id: messageB.id } });
      expect(messageBResult?.content).toBe('conteúdo antigo B');

      const heldMessageResult = await prisma.message.findUnique({ where: { id: heldMessage.id } });
      expect(heldMessageResult?.content).toBe('sob hold');
    });
  });

  describe('privacy notice invariant', () => {
    it('never leaves an active profile without privacyNoticeText', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/qualification-profiles',
        headers: authHeaders(ownerA),
        payload: { name: 'Sem aviso', active: false },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().privacyNoticeText).toBeNull();

      const activated = await app.inject({
        method: 'PATCH',
        url: `/api/qualification-profiles/${created.json().id}`,
        headers: authHeaders(ownerA),
        payload: { active: true },
      });
      expect(activated.statusCode).toBe(200);
      expect(activated.json().active).toBe(true);
      expect(activated.json().privacyNoticeText).toBeTruthy();
    });
  });
});
