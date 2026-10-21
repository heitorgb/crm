import { describe, expect, it } from 'vitest';
import { parseSalesAnalysis, parseSalesReply } from '../../../src/modules/ai/sales-copilot.parser.js';

const VALID = {
  summary: 'Resumo',
  objective: 'Objetivo comercial',
  need: 'Necessidade',
  knownInformation: ['Fato 1'],
  hypotheses: ['Hipótese: suposição'],
  pendingInformation: ['Lacuna 1'],
  nextQuestion: 'Pergunta?',
  suggestedReply: 'Resposta sugerida.',
  rationale: 'Justificativa.',
  nextAction: {
    action: 'Próxima ação',
    reason: 'Motivo',
    priority: 'MEDIUM',
    expectedOutcome: 'Resultado esperado',
    missingInformation: ['Informação faltante'],
    suggestedDueAt: null,
    suggestedMessage: null,
  },
  leadUpdateSuggestions: [
    { field: 'NEED', proposedValue: 'Necessidade confirmada', evidence: 'Evidência' },
  ],
};

describe('sales copilot parser', () => {
  it('parses a valid JSON object', () => {
    expect(parseSalesAnalysis(JSON.stringify(VALID))).toEqual(VALID);
  });

  it('accepts a JSON object wrapped in a markdown code fence', () => {
    expect(parseSalesAnalysis(`\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``)).toEqual(VALID);
  });

  it('accepts JSON with surrounding commentary and ignores extra keys', () => {
    const raw = `Segue a análise:\n${JSON.stringify({ ...VALID, extra: true })}\nFim.`;
    expect(parseSalesAnalysis(raw)).toEqual(VALID);
  });

  it('trims list items and drops empty entries', () => {
    const parsed = parseSalesAnalysis(
      JSON.stringify({
        ...VALID,
        knownInformation: ['  Fato  ', '', 'Outro fato'],
        pendingInformation: ['   '],
      }),
    );

    expect(parsed.knownInformation).toEqual(['Fato', 'Outro fato']);
    expect(parsed.pendingInformation).toEqual([]);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseSalesAnalysis('não é json')).toThrow(
      expect.objectContaining({ code: 'AI_SALES_INVALID_RESPONSE' }),
    );
  });

  it('rejects a payload missing required fields', () => {
    expect(() => parseSalesAnalysis(JSON.stringify({ summary: 'só isso' }))).toThrow(
      expect.objectContaining({ code: 'AI_SALES_INVALID_RESPONSE' }),
    );
  });

  it('rejects invalid priorities and lead update fields', () => {
    expect(() =>
      parseSalesAnalysis(
        JSON.stringify({
          ...VALID,
          nextAction: { ...VALID.nextAction, priority: 'URGENT' },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SALES_INVALID_RESPONSE' }));

    expect(() =>
      parseSalesAnalysis(
        JSON.stringify({
          ...VALID,
          leadUpdateSuggestions: [{ field: 'ARBITRARY', proposedValue: 'x', evidence: 'y' }],
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SALES_INVALID_RESPONSE' }));
  });

  it('rejects an empty or oversized reply', () => {
    expect(() => parseSalesReply('   ')).toThrow(
      expect.objectContaining({ code: 'AI_SALES_INVALID_RESPONSE' }),
    );
    expect(() => parseSalesReply('a'.repeat(4_001))).toThrow(
      expect.objectContaining({ code: 'AI_SALES_INVALID_RESPONSE' }),
    );
  });

  it('returns a plain reply without code fences', () => {
    expect(parseSalesReply('```\nOlá, tudo bem?\n```')).toBe('Olá, tudo bem?');
  });
});
