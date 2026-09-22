import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import type { AiEvaluationInput, AiProvider } from '../../src/modules/qualification/ai/ai-provider.types.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

class MutableAiProvider implements AiProvider {
  readonly info = { provider: 'fake', model: 'fake-model' };
  readonly calls: AiEvaluationInput[] = [];
  private responses: unknown[] = [];

  setResponses(responses: unknown[]): void {
    this.responses = [...responses];
    this.calls.length = 0;
  }

  async evaluate(input: AiEvaluationInput): Promise<unknown> {
    this.calls.push(input);
    if (this.responses.length === 0) {
      return { action: 'ASK', question: 'Pode detalhar?', collectedData: {}, missingInformation: [] };
    }
    return this.responses.shift();
  }
}

const ai = new MutableAiProvider();

describe('Qualification engine API (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp({ aiProvider: ai });
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    ai.setResponses([]);
    ownerA = await seedTenant(app, prisma, { name: 'Qual Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Qual User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Qual Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  async function createProfile(
    tenant: SeededTenant,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/qualification-profiles',
      headers: authHeaders(tenant),
      payload: {
        name: 'Perfil padrão',
        isDefault: true,
        requiredInformation: [
          { key: 'budget', label: 'Orçamento', required: true },
          { key: 'timing', label: 'Prazo', required: true },
        ],
        qualificationLevels: [
          { key: 'HOT', label: 'Quente' },
          { key: 'COLD', label: 'Frio' },
        ],
        ...overrides,
      },
    });
    return response.json().id as string;
  }

  async function createLead(tenant: SeededTenant, name = 'Lead Qual'): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: authHeaders(tenant),
      payload: { name },
    });
    return response.json().id as string;
  }

  function startSession(tenant: SeededTenant, leadId: string, profileId?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/leads/${leadId}/qualification-sessions`,
      headers: authHeaders(tenant),
      payload: profileId ? { profileId } : {},
    });
  }

  function sendMessage(tenant: SeededTenant, sessionId: string, message: string) {
    return app.inject({
      method: 'POST',
      url: `/api/qualification-sessions/${sessionId}/messages`,
      headers: authHeaders(tenant),
      payload: { message },
    });
  }

  describe('session lifecycle', () => {
    it('starts a session with the default profile and missing information', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);

      const response = await startSession(ownerA, leadId);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        leadId,
        status: 'BOT_QUALIFYING',
        questionCount: 0,
        reviewRequested: false,
        profileVersion: 1,
      });
      expect(response.json().missingInformation).toEqual(['budget', 'timing']);
      expect(response.json()).not.toHaveProperty('tenantId');
    });

    it('reuses an active session for the same lead', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);

      const first = await startSession(ownerA, leadId);
      const second = await startSession(ownerA, leadId);

      expect(second.json().id).toBe(first.json().id);
    });

    it('rejects starting without an active profile or with another tenant profile', async () => {
      const leadId = await createLead(ownerA);

      const noProfile = await startSession(ownerA, leadId);
      expect(noProfile.statusCode).toBe(409);
      expect(noProfile.json().code).toBe('QUALIFICATION_PROFILE_UNAVAILABLE');

      const foreignProfileId = await createProfile(ownerB);
      const foreign = await startSession(ownerA, leadId, foreignProfileId);
      expect(foreign.statusCode).toBe(409);
    });
  });

  describe('conversation', () => {
    it('asks the next question and does not repeat collected information', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);
      const sessionId = session.json().id as string;

      ai.setResponses([
        {
          action: 'ASK',
          question: 'Qual o prazo desejado?',
          collectedData: { budget: '15000' },
          missingInformation: ['timing'],
        },
      ]);

      const response = await sendMessage(ownerA, sessionId, 'Meu orçamento é 15000');

      expect(response.statusCode).toBe(201);
      expect(response.json().session.collectedData).toEqual({ budget: '15000' });
      expect(response.json().session.missingInformation).toEqual(['timing']);
      expect(response.json().decision.action).toBe('ASK');
      expect(response.json().session.questionCount).toBe(1);

      expect(ai.calls[0].collectedData).toEqual({});
      expect(ai.calls[0].missingInformation).toEqual(['budget', 'timing']);
    });

    it('minimizes collected data to the profile keys and ignores sensitive keys', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);

      ai.setResponses([
        {
          action: 'ASK',
          question: 'Continuando',
          collectedData: { budget: '15000', health_condition: 'x', not_in_profile: 'y' },
          missingInformation: [],
        },
      ]);

      const response = await sendMessage(ownerA, session.json().id as string, 'Tenho 15000');

      expect(response.json().session.collectedData).toEqual({ budget: '15000' });
      expect(response.json().session.collectedData).not.toHaveProperty('health_condition');
    });

    it('completes the qualification and creates an analysis', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);
      const sessionId = session.json().id as string;

      ai.setResponses([
        {
          action: 'ASK',
          question: 'Qual o prazo?',
          collectedData: { budget: '15000' },
          missingInformation: ['timing'],
        },
        {
          action: 'COMPLETE',
          outcome: 'QUALIFIED',
          score: 88,
          qualificationLevel: 'HOT',
          summary: 'Bom ajuste ao perfil.',
          strengths: ['Orçamento adequado'],
          risks: [],
          missingInformation: [],
          recommendedNextStep: 'Agendar reunião',
          qualificationReasons: ['Orçamento compatível'],
          collectedData: { budget: '15000', timing: '30 dias' },
        },
      ]);

      await sendMessage(ownerA, sessionId, 'Orçamento de 15000');
      const completed = await sendMessage(ownerA, sessionId, 'O prazo é 30 dias');

      expect(completed.statusCode).toBe(201);
      expect(completed.json().session.status).toBe('QUALIFIED');
      expect(completed.json().analysis).toMatchObject({
        outcome: 'QUALIFIED',
        score: 88,
        qualificationLevel: 'HOT',
        provider: 'fake',
        model: 'fake-model',
      });

      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      expect(lead?.status).toBe('QUALIFIED_WAITING_DIGEST');

      const analyses = await app.inject({
        method: 'GET',
        url: `/api/lead-analyses?leadId=${leadId}`,
        headers: authHeaders(ownerA),
      });
      expect(analyses.json().data).toHaveLength(1);
    });

    it('records a disqualification with an objective reason', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);

      ai.setResponses([
        {
          action: 'COMPLETE',
          outcome: 'DISQUALIFIED',
          score: 10,
          qualificationLevel: 'COLD',
          summary: 'Fora do perfil.',
          strengths: [],
          risks: [],
          missingInformation: [],
          recommendedNextStep: null,
          qualificationReasons: ['Orçamento não informado/não possui'],
          collectedData: { budget: '0', timing: 'indefinido' },
        },
      ]);

      const response = await sendMessage(ownerA, session.json().id as string, 'Sem orçamento');

      expect(response.json().session.status).toBe('DISQUALIFIED');
      expect(response.json().analysis.outcome).toBe('DISQUALIFIED');
      expect(response.json().analysis.qualificationReasons).toEqual([
        'Orçamento não informado/não possui',
      ]);

      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      expect(lead?.status).toBe('DISQUALIFIED');
    });

    it('forces NEEDS_HUMAN for disqualification on high sensitivity profiles', async () => {
      await createProfile(ownerA, { dataSensitivityLevel: 'high' });
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);

      ai.setResponses([
        {
          action: 'COMPLETE',
          outcome: 'DISQUALIFIED',
          score: 10,
          qualificationLevel: 'COLD',
          summary: 'Fora do perfil.',
          strengths: [],
          risks: [],
          missingInformation: [],
          recommendedNextStep: null,
          qualificationReasons: ['Critério X não atendido'],
          collectedData: { budget: '0', timing: 'indefinido' },
        },
      ]);

      const response = await sendMessage(ownerA, session.json().id as string, 'Sem orçamento');

      expect(response.json().session.status).toBe('NEEDS_HUMAN');
      expect(response.json().analysis).toBeNull();
      expect(response.json().session.handoffReason).toBe('high_sensitivity_requires_human');
    });

    it('handles an invalid structured result as handoff', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);

      ai.setResponses([{ action: 'UNKNOWN', foo: 'bar' }]);

      const response = await sendMessage(ownerA, session.json().id as string, 'Oi');

      expect(response.json().session.status).toBe('NEEDS_HUMAN');
      expect(response.json().session.handoffReason).toBe('invalid_ai_response');
    });

    it('respects a provider NEEDS_HUMAN action', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);

      ai.setResponses([{ action: 'NEEDS_HUMAN', reason: 'out_of_scope', collectedData: {} }]);

      const response = await sendMessage(ownerA, session.json().id as string, 'Oi');

      expect(response.json().session.status).toBe('NEEDS_HUMAN');
      expect(response.json().session.handoffReason).toBe('out_of_scope');
    });

    it('rejects messages on a completed session', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);
      const sessionId = session.json().id as string;

      ai.setResponses([
        {
          action: 'COMPLETE',
          outcome: 'QUALIFIED',
          score: 90,
          qualificationLevel: 'HOT',
          summary: 'Ok',
          strengths: [],
          risks: [],
          missingInformation: [],
          recommendedNextStep: null,
          qualificationReasons: [],
          collectedData: { budget: '1', timing: '1' },
        },
      ]);
      await sendMessage(ownerA, sessionId, 'Tudo certo');

      const rejected = await sendMessage(ownerA, sessionId, 'Mais uma');
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().code).toBe('QUALIFICATION_SESSION_NOT_ACTIVE');
    });
  });

  describe('review and reanalysis', () => {
    async function completedSession(tenant: SeededTenant): Promise<string> {
      await createProfile(tenant);
      const leadId = await createLead(tenant);
      const session = await startSession(tenant, leadId);
      const sessionId = session.json().id as string;

      ai.setResponses([
        {
          action: 'COMPLETE',
          outcome: 'DISQUALIFIED',
          score: 5,
          qualificationLevel: 'COLD',
          summary: 'Fora',
          strengths: [],
          risks: [],
          missingInformation: [],
          recommendedNextStep: null,
          qualificationReasons: ['Critério não atendido'],
          collectedData: { budget: '0', timing: '0' },
        },
      ]);
      await sendMessage(tenant, sessionId, 'Sem condições');
      return sessionId;
    }

    it('reopens a completed session when the lead requests review', async () => {
      const sessionId = await completedSession(ownerA);

      const response = await app.inject({
        method: 'POST',
        url: `/api/qualification-sessions/${sessionId}/review`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        status: 'NEEDS_HUMAN',
        reviewRequested: true,
        handoffReason: 'lead_requested_review',
      });
      expect(response.json().reviewRequestedAt).not.toBeNull();
    });

    it('reanalyzes when authorized and creates a new analysis', async () => {
      const sessionId = await completedSession(ownerA);

      ai.setResponses([
        {
          action: 'COMPLETE',
          outcome: 'QUALIFIED',
          score: 70,
          qualificationLevel: 'HOT',
          summary: 'Reconsiderado.',
          strengths: [],
          risks: [],
          missingInformation: [],
          recommendedNextStep: null,
          qualificationReasons: ['Reavaliação manual'],
          collectedData: { budget: '0', timing: '0' },
        },
      ]);

      const response = await app.inject({
        method: 'POST',
        url: `/api/qualification-sessions/${sessionId}/reanalyze`,
        headers: authHeaders(ownerA),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().analysis.outcome).toBe('QUALIFIED');
      expect(response.json().session.status).toBe('QUALIFIED');

      const forbidden = await app.inject({
        method: 'POST',
        url: `/api/qualification-sessions/${sessionId}/reanalyze`,
        headers: authHeaders(userA),
      });
      expect(forbidden.statusCode).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('never exposes sessions or analyses of another tenant', async () => {
      await createProfile(ownerA);
      const leadId = await createLead(ownerA);
      const session = await startSession(ownerA, leadId);
      const sessionId = session.json().id as string;

      ai.setResponses([
        {
          action: 'COMPLETE',
          outcome: 'QUALIFIED',
          score: 90,
          qualificationLevel: 'HOT',
          summary: 'Ok',
          strengths: [],
          risks: [],
          missingInformation: [],
          recommendedNextStep: null,
          qualificationReasons: [],
          collectedData: { budget: '1', timing: '1' },
        },
      ]);
      const completed = await sendMessage(ownerA, sessionId, 'Tudo pronto');
      const analysisId = completed.json().analysis.id as string;

      const readSession = await app.inject({
        method: 'GET',
        url: `/api/qualification-sessions/${sessionId}`,
        headers: authHeaders(ownerB),
      });
      expect(readSession.statusCode).toBe(404);

      const readAnalysis = await app.inject({
        method: 'GET',
        url: `/api/lead-analyses/${analysisId}`,
        headers: authHeaders(ownerB),
      });
      expect(readAnalysis.statusCode).toBe(404);

      const listB = await app.inject({
        method: 'GET',
        url: '/api/lead-analyses',
        headers: authHeaders(ownerB),
      });
      expect(listB.json().data).toHaveLength(0);
    });
  });
});
