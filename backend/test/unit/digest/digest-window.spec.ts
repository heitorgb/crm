import {
  computeDigestWindow,
  renderDigestText,
} from '../../../src/modules/digest/lead-digest.service.js';

describe('computeDigestWindow', () => {
  it('uses the configured timezone when the time already passed today', () => {
    const now = new Date('2026-01-10T14:00:00.000Z');
    const window = computeDigestWindow(now, '09:00', 'America/Sao_Paulo');

    expect(window.periodEnd.toISOString()).toBe('2026-01-10T12:00:00.000Z');
    expect(window.periodStart.toISOString()).toBe('2026-01-09T12:00:00.000Z');
  });

  it('uses the previous day when the local time has not arrived yet', () => {
    const now = new Date('2026-01-10T10:00:00.000Z');
    const window = computeDigestWindow(now, '09:00', 'America/Sao_Paulo');

    expect(window.periodEnd.toISOString()).toBe('2026-01-09T12:00:00.000Z');
    expect(window.periodStart.toISOString()).toBe('2026-01-08T12:00:00.000Z');
  });

  it('handles a UTC preference', () => {
    const now = new Date('2026-01-10T09:30:00.000Z');
    const window = computeDigestWindow(now, '09:00', 'UTC');

    expect(window.periodEnd.toISOString()).toBe('2026-01-10T09:00:00.000Z');
    expect(window.periodStart.toISOString()).toBe('2026-01-09T09:00:00.000Z');
  });
});

describe('renderDigestText', () => {
  it('renders a single grouped message with the useful fields', () => {
    const text = renderDigestText([
      {
        leadId: 'lead-1',
        name: 'João',
        phone: '+5511999999999',
        score: 92,
        qualificationLevel: 'Alta',
        summary: 'Precisa de X, orçamento Y.',
        recommendedNextStep: 'Enviar proposta',
        qualificationReasons: ['Orçamento ok'],
      },
    ]);

    expect(text).toContain('Leads qualificados: 1');
    expect(text).toContain('João');
    expect(text).toContain('92/100');
    expect(text).toContain('Próxima ação: Enviar proposta');
  });
});
