import type {
  AiEvaluationInput,
  AiProfileConfig,
  AiProvider,
} from '../../../src/modules/qualification/ai/ai-provider.types.js';
import { QualificationEngineService } from '../../../src/modules/qualification/qualification-engine.service.js';

class ScriptedProvider implements AiProvider {
  readonly info = { provider: 'scripted', model: 'test-model' };
  readonly calls: AiEvaluationInput[] = [];

  constructor(
    private readonly responses: unknown[],
    private readonly error?: Error,
  ) {}

  async evaluate(input: AiEvaluationInput): Promise<unknown> {
    this.calls.push(input);
    if (this.error) {
      throw this.error;
    }
    return this.responses.length > 0 ? this.responses.shift() : null;
  }
}

const baseProfile: AiProfileConfig = {
  name: 'Perfil de teste',
  businessContext: null,
  botName: null,
  tone: null,
  objective: null,
  requiredInformation: [
    { key: 'budget', label: 'Orçamento', required: true },
    { key: 'timing', label: 'Prazo', required: true },
  ],
  qualificationCriteria: [{ key: 'budget_fit', label: 'Orçamento compatível', weight: 50 }],
  disqualificationCriteria: [{ key: 'no_budget', label: 'Sem orçamento' }],
  completionCriteria: [],
  humanHandoffRules: [],
  qualificationLevels: [
    { key: 'HOT', label: 'Quente' },
    { key: 'COLD', label: 'Frio' },
  ],
  customInstructions: null,
  privacyNoticeText: null,
};

function evaluate(
  provider: AiProvider,
  overrides: Partial<Parameters<QualificationEngineService['evaluate']>[0]> = {},
) {
  const engine = new QualificationEngineService(provider);
  return engine.evaluate({
    profile: baseProfile,
    dataSensitivityLevel: 'low',
    collectedData: {},
    transcript: [],
    ...overrides,
  });
}

describe('QualificationEngineService', () => {
  it('returns ASK with the next question', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'ASK',
        question: 'Qual é o seu orçamento?',
        collectedData: {},
        missingInformation: ['budget', 'timing'],
      },
    ]);

    const decision = await evaluate(provider);

    expect(decision.action).toBe('ASK');
    if (decision.action === 'ASK') {
      expect(decision.question).toBe('Qual é o seu orçamento?');
      expect(decision.missingInformation).toEqual(['budget', 'timing']);
    }
  });

  it('keeps previously collected data and never repeats it', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'ASK',
        question: 'Qual é o prazo?',
        collectedData: { timing: '30 dias' },
        missingInformation: [],
      },
    ]);

    const decision = await evaluate(provider, { collectedData: { budget: '15000' } });

    expect(decision.action).toBe('ASK');
    expect(decision.collectedData).toEqual({ budget: '15000', timing: '30 dias' });
    expect(decision.missingInformation).toEqual([]);
    expect(provider.calls[0].collectedData).toEqual({ budget: '15000' });
  });

  it('only persists keys defined in requiredInformation', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'ASK',
        question: 'Continuando…',
        collectedData: {
          budget: '15000',
          not_in_profile: 'x',
          religion: 'algo',
        },
        missingInformation: [],
      },
    ]);

    const decision = await evaluate(provider);

    expect(decision.collectedData).toEqual({ budget: '15000' });
    expect(decision.collectedData).not.toHaveProperty('not_in_profile');
    expect(decision.collectedData).not.toHaveProperty('religion');
  });

  it('completes a qualified analysis', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'COMPLETE',
        outcome: 'QUALIFIED',
        score: 90,
        qualificationLevel: 'HOT',
        summary: 'Bom ajuste.',
        strengths: ['Orçamento adequado'],
        risks: [],
        missingInformation: [],
        recommendedNextStep: 'Agendar reunião',
        qualificationReasons: ['Orçamento compatível', 'Prazo definido'],
        collectedData: { budget: '15000', timing: '30 dias' },
      },
    ]);

    const decision = await evaluate(provider);

    expect(decision.action).toBe('COMPLETE');
    if (decision.action === 'COMPLETE') {
      expect(decision.outcome).toBe('QUALIFIED');
      expect(decision.score).toBe(90);
      expect(decision.qualificationLevel).toBe('HOT');
      expect(decision.qualificationReasons).toContain('Orçamento compatível');
    }
  });

  it('falls back to ASK when mandatory information is missing on COMPLETE', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'COMPLETE',
        outcome: 'QUALIFIED',
        score: 80,
        qualificationLevel: 'HOT',
        summary: 'Quase.',
        strengths: [],
        risks: [],
        missingInformation: [],
        recommendedNextStep: null,
        qualificationReasons: [],
        collectedData: { budget: '15000' },
      },
    ]);

    const decision = await evaluate(provider);

    expect(decision.action).toBe('ASK');
    if (decision.action === 'ASK') {
      expect(decision.question).toContain('Prazo');
      expect(decision.missingInformation).toEqual(['timing']);
    }
  });

  it('rejects an unknown qualification level', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'COMPLETE',
        outcome: 'QUALIFIED',
        score: 80,
        qualificationLevel: 'UNKNOWN',
        summary: 'Resumo',
        strengths: [],
        risks: [],
        missingInformation: [],
        recommendedNextStep: null,
        qualificationReasons: [],
        collectedData: { budget: '15000', timing: '30 dias' },
      },
    ]);

    const decision = await evaluate(provider);
    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('invalid_qualification_level');
    }
  });

  it('rejects an out-of-range score', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'COMPLETE',
        outcome: 'QUALIFIED',
        score: 150,
        qualificationLevel: 'HOT',
        summary: 'Resumo',
        strengths: [],
        risks: [],
        missingInformation: [],
        recommendedNextStep: null,
        qualificationReasons: [],
        collectedData: { budget: '15000', timing: '30 dias' },
      },
    ]);

    const decision = await evaluate(provider);
    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('invalid_score');
    }
  });

  it('completes a disqualification with an objective reason', async () => {
    const provider = new ScriptedProvider([
      {
        action: 'COMPLETE',
        outcome: 'DISQUALIFIED',
        score: 10,
        qualificationLevel: 'COLD',
        summary: 'Fora do perfil.',
        strengths: [],
        risks: ['Sem orçamento'],
        missingInformation: [],
        recommendedNextStep: null,
        qualificationReasons: ['Sem orçamento informado'],
        collectedData: { budget: '0', timing: 'indefinido' },
      },
    ]);

    const decision = await evaluate(provider);
    expect(decision.action).toBe('COMPLETE');
    if (decision.action === 'COMPLETE') {
      expect(decision.outcome).toBe('DISQUALIFIED');
      expect(decision.qualificationReasons).toEqual(['Sem orçamento informado']);
    }
  });

  it('requires an objective reason for disqualification', async () => {
    const provider = new ScriptedProvider([
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
        qualificationReasons: [],
        collectedData: { budget: '0', timing: 'indefinido' },
      },
    ]);

    const decision = await evaluate(provider);
    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('missing_disqualification_reason');
    }
  });

  it('never automatically disqualifies a high sensitivity profile', async () => {
    const provider = new ScriptedProvider([
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
        qualificationReasons: ['Sem orçamento'],
        collectedData: { budget: '0', timing: 'indefinido' },
      },
    ]);

    const decision = await evaluate(provider, { dataSensitivityLevel: 'high' });
    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('high_sensitivity_requires_human');
    }
  });

  it('handles an invalid structured result', async () => {
    const provider = new ScriptedProvider([{ action: 'SOMETHING_ELSE' }]);
    const decision = await evaluate(provider);
    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('invalid_ai_response');
    }
  });

  it('hands off when the provider throws', async () => {
    const provider = new ScriptedProvider([], new Error('provider down'));
    const decision = await evaluate(provider);
    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('provider_error');
    }
  });

  it('hands off when the lead explicitly asks for a human', async () => {
    const provider = new ScriptedProvider([]);
    const decision = await evaluate(provider, { lastLeadMessage: 'Quero falar com um atendente' });

    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('lead_requested_human');
    }
    expect(provider.calls).toHaveLength(0);
  });

  it('hands off when sensitive data is mentioned', async () => {
    const provider = new ScriptedProvider([]);
    const decision = await evaluate(provider, {
      lastLeadMessage: 'Tenho um problema de saúde e preciso de ajuda',
    });

    expect(decision.action).toBe('NEEDS_HUMAN');
    if (decision.action === 'NEEDS_HUMAN') {
      expect(decision.reason).toBe('sensitive_data_mentioned');
      // Sensitive content is never structured into collectedData.
      expect(decision.collectedData).toEqual({});
    }
    expect(provider.calls).toHaveLength(0);
  });
});
