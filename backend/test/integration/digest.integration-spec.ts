import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { LeadDigestService } from '../../src/modules/digest/lead-digest.service.js';
import type {
  AiEvaluationInput,
  AiProvider,
} from '../../src/modules/qualification/ai/ai-provider.types.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

class FakeEvolution {
  configured = true;
  failNext = false;
  readonly sent: { number: string; text: string }[] = [];

  async sendText(_instance: string, number: string, text: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('evolution down');
    }
    this.sent.push({ number, text });
    return { externalMessageId: `ext-${this.sent.length}`, raw: {} };
  }

  async connect() {
    return {};
  }

  async disconnect() {
    return {};
  }

  async getConnectionState() {
    return { instance: 'fake', state: 'open' };
  }

  async setWebhook() {
    return {};
  }
}

class NoopAiProvider implements AiProvider {
  readonly info = { provider: 'fake', model: 'fake-model' };
  async evaluate(_input: AiEvaluationInput): Promise<unknown> {
    return { action: 'ASK', question: '?', collectedData: {}, missingInformation: [] };
  }
}

const evolution = new FakeEvolution();

describe('Lead digest (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let digest: LeadDigestService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  const WINDOW_START = new Date('2026-01-10T00:00:00.000Z');
  const WINDOW_END = new Date('2026-01-11T00:00:00.000Z');

  beforeAll(async () => {
    context = await createTestApp({ aiProvider: new NoopAiProvider(), evolution });
    app = context.app;
    prisma = context.prisma;
    digest = app.get(LeadDigestService);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    evolution.sent.length = 0;
    evolution.failNext = false;
    ownerA = await seedTenant(app, prisma, { name: 'Digest Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Digest User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Digest Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  async function seedQualifiedLead(
    tenant: SeededTenant,
    options: { createdAt: Date; name?: string },
  ): Promise<{ leadId: string }> {
    const profile = await prisma.qualificationProfile.create({
      data: { tenantId: tenant.tenantId, name: `perfil-${randomUUID()}`, isDefault: false, active: true },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.tenantId,
        name: options.name ?? 'Lead Digest',
        phone: `+55119${Math.floor(10000000 + Math.random() * 89999999)}`,
        status: 'QUALIFIED_WAITING_DIGEST',
      },
    });
    const session = await prisma.leadQualificationSession.create({
      data: {
        tenantId: tenant.tenantId,
        leadId: lead.id,
        profileId: profile.id,
        profileVersion: 1,
        status: 'QUALIFIED',
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
        model: 'fake-model',
        outcome: 'QUALIFIED',
        score: 91,
        qualificationLevel: 'HOT',
        summary: 'Resumo útil',
        collectedData: {},
        strengths: [],
        risks: [],
        missingInformation: [],
        recommendedNextStep: 'Enviar proposta',
        qualificationReasons: ['Orçamento ok'],
        createdAt: options.createdAt,
        completedAt: options.createdAt,
      },
    });

    return { leadId: lead.id };
  }

  function putPreference(
    tenant: SeededTenant,
    overrides: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'PUT',
      url: '/api/settings/lead-digest/preference',
      headers: authHeaders(tenant),
      payload: {
        deliveryTime: '09:00',
        timeZone: 'America/Sao_Paulo',
        channel: 'INTERNAL',
        ...overrides,
      },
    });
  }

  it('delivers leads from the window once and marks them assigned', async () => {
    await putPreference(ownerA);
    const inWindow = await seedQualifiedLead(ownerA, {
      createdAt: new Date('2026-01-10T10:00:00.000Z'),
    });
    const outOfWindow = await seedQualifiedLead(ownerA, {
      createdAt: new Date('2026-01-05T10:00:00.000Z'),
    });

    await digest.deliver({
      tenantId: ownerA.tenantId,
      tenantUserId: ownerA.membershipId,
      periodStart: WINDOW_START,
      periodEnd: WINDOW_END,
    });

    const deliveries = await prisma.leadDigestDelivery.findMany({
      where: { tenantId: ownerA.tenantId },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: 'SENT', leadCount: 1 });

    const assigned = await prisma.lead.findUnique({ where: { id: inWindow.leadId } });
    expect(assigned?.status).toBe('ASSIGNED');

    const untouched = await prisma.lead.findUnique({ where: { id: outOfWindow.leadId } });
    expect(untouched?.status).toBe('QUALIFIED_WAITING_DIGEST');

    // Idempotent: running again does not create another delivery.
    await digest.deliver({
      tenantId: ownerA.tenantId,
      tenantUserId: ownerA.membershipId,
      periodStart: WINDOW_START,
      periodEnd: WINDOW_END,
    });
    expect(await prisma.leadDigestDelivery.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
  });

  it('skips the window when there are zero leads', async () => {
    await putPreference(ownerA);

    await digest.deliver({
      tenantId: ownerA.tenantId,
      tenantUserId: ownerA.membershipId,
      periodStart: WINDOW_START,
      periodEnd: WINDOW_END,
    });

    const delivery = await prisma.leadDigestDelivery.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(delivery.status).toBe('SKIPPED');
    expect(delivery.leadCount).toBe(0);
  });

  it('never mixes leads from another tenant', async () => {
    await putPreference(ownerA);
    await putPreference(ownerB);
    await seedQualifiedLead(ownerA, { createdAt: new Date('2026-01-10T10:00:00.000Z') });
    const foreign = await seedQualifiedLead(ownerB, {
      createdAt: new Date('2026-01-10T10:00:00.000Z'),
    });

    await digest.deliver({
      tenantId: ownerA.tenantId,
      tenantUserId: ownerA.membershipId,
      periodStart: WINDOW_START,
      periodEnd: WINDOW_END,
    });

    const foreignLead = await prisma.lead.findUnique({ where: { id: foreign.leadId } });
    expect(foreignLead?.status).toBe('QUALIFIED_WAITING_DIGEST');
    expect(await prisma.leadDigestDelivery.count({ where: { tenantId: ownerB.tenantId } })).toBe(0);
  });

  it('preserves pending leads on failure and succeeds on retry', async () => {
    const instanceName = `digest-${randomUUID()}`;
    await app.inject({
      method: 'POST',
      url: '/api/whatsapp/instances',
      headers: authHeaders(ownerA),
      payload: { name: 'Digest instance', instanceName },
    });
    await putPreference(ownerA, {
      channel: 'WHATSAPP',
      whatsappDestination: '+5511888888888',
    });
    const { leadId } = await seedQualifiedLead(ownerA, {
      createdAt: new Date('2026-01-10T10:00:00.000Z'),
    });

    evolution.failNext = true;
    await expect(
      digest.deliver({
        tenantId: ownerA.tenantId,
        tenantUserId: ownerA.membershipId,
        periodStart: WINDOW_START,
        periodEnd: WINDOW_END,
      }),
    ).rejects.toBeTruthy();

    const failed = await prisma.leadDigestDelivery.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(failed.status).toBe('FAILED');
    const stillPending = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(stillPending?.status).toBe('QUALIFIED_WAITING_DIGEST');

    await digest.deliver({
      tenantId: ownerA.tenantId,
      tenantUserId: ownerA.membershipId,
      periodStart: WINDOW_START,
      periodEnd: WINDOW_END,
    });

    const delivered = await prisma.leadDigestDelivery.findFirstOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(delivered.status).toBe('SENT');
    expect(evolution.sent).toHaveLength(1);
    expect(evolution.sent[0].number).toBe('5511888888888');
    expect(evolution.sent[0].text).toContain('Resumo útil');

    const assigned = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(assigned?.status).toBe('ASSIGNED');
  });

  it('validates the preference payload', async () => {
    const invalidZone = await putPreference(ownerA, { timeZone: 'Not/AZone' });
    expect(invalidZone.statusCode).toBe(400);

    const missingTime = await app.inject({
      method: 'PUT',
      url: '/api/settings/lead-digest/preference',
      headers: authHeaders(ownerA),
      payload: { timeZone: 'UTC' },
    });
    expect(missingTime.statusCode).toBe(400);
  });

  it('exposes the internal overview with pending and delivered leads', async () => {
    await putPreference(ownerA);
    await seedQualifiedLead(ownerA, { createdAt: new Date('2026-01-10T10:00:00.000Z') });

    const overview = await app.inject({
      method: 'GET',
      url: '/api/settings/lead-digest/overview',
      headers: authHeaders(ownerA),
    });

    expect(overview.statusCode).toBe(200);
    expect(overview.json().awaitingDigest).toHaveLength(1);
    expect(overview.json().recentDeliveries).toHaveLength(0);
  });

  it('runs the digest manually for the current window', async () => {
    await putPreference(ownerA);

    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/lead-digest/run',
      headers: authHeaders(ownerA),
    });

    expect(response.statusCode).toBe(202);
    expect(await prisma.leadDigestDelivery.count({ where: { tenantId: ownerA.tenantId } })).toBe(1);
  });
});
