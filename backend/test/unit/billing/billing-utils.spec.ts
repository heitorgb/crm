import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  isValidDateOnly,
  isWithinWindow,
  localDateString,
  localHour,
  parseDateOnly,
  startOfDayInTimeZone,
  formatDateBR,
  formatDateOnly,
} from '../../../src/modules/billing/billing-time.js';
import { BILLING_DEFAULT_MESSAGE_TEMPLATE } from '../../../src/modules/billing/billing.constants.js';
import {
  formatCurrencyBRL,
  normalizeReminderOffsets,
  renderReminderTemplate,
  type ReminderTemplateVars,
} from '../../../src/modules/billing/billing-message.js';

describe('billing-time', () => {
  it('validates date-only strings', () => {
    expect(isValidDateOnly('2026-10-16')).toBe(true);
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('16/10/2026')).toBe(false);
    expect(isValidDateOnly('2026-1-1')).toBe(false);
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('adds months clamping to the last valid day', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('round-trips parse/format', () => {
    expect(formatDateOnly(parseDateOnly('2026-10-16'))).toBe('2026-10-16');
  });

  it('formats dates in the Brazilian DD/MM/YYYY format', () => {
    expect(formatDateBR(parseDateOnly('2026-10-16'))).toBe('16/10/2026');
    expect(formatDateBR(parseDateOnly('2027-01-05'))).toBe('05/01/2027');
  });

  it('resolves the local hour and date in a time zone', () => {
    const noonUtc = new Date('2026-10-16T12:00:00.000Z');
    expect(localHour(noonUtc, 'America/Sao_Paulo')).toBe(9);
    expect(localDateString(noonUtc, 'America/Sao_Paulo')).toBe('2026-10-16');

    const earlyUtc = new Date('2026-10-16T02:00:00.000Z');
    expect(localHour(earlyUtc, 'America/Sao_Paulo')).toBe(23);
    expect(localDateString(earlyUtc, 'America/Sao_Paulo')).toBe('2026-10-15');
  });

  it('resolves the start of a local day as a UTC instant', () => {
    expect(startOfDayInTimeZone('2026-10-20', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-20T03:00:00.000Z',
    );
    expect(startOfDayInTimeZone('2026-10-21', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-21T03:00:00.000Z',
    );
    expect(startOfDayInTimeZone('2026-10-20', 'UTC').toISOString()).toBe(
      '2026-10-20T00:00:00.000Z',
    );
  });

  it('evaluates the send window including the overnight case', () => {
    expect(isWithinWindow(8, 8, 18)).toBe(true);
    expect(isWithinWindow(18, 8, 18)).toBe(true);
    expect(isWithinWindow(7, 8, 18)).toBe(false);
    expect(isWithinWindow(19, 8, 18)).toBe(false);

    expect(isWithinWindow(22, 22, 6)).toBe(true);
    expect(isWithinWindow(23, 22, 6)).toBe(true);
    expect(isWithinWindow(5, 22, 6)).toBe(true);
    expect(isWithinWindow(6, 22, 6)).toBe(true);
    expect(isWithinWindow(12, 22, 6)).toBe(false);

    // start === end opens the whole day.
    expect(isWithinWindow(0, 8, 8)).toBe(true);
    expect(isWithinWindow(8, 8, 8)).toBe(true);
    expect(isWithinWindow(23, 8, 8)).toBe(true);
  });
});

describe('billing-message', () => {
  it('formats cents as BRL without floating point artefacts', () => {
    expect(formatCurrencyBRL(0)).toBe('R$ 0,00');
    expect(formatCurrencyBRL(5)).toBe('R$ 0,05');
    expect(formatCurrencyBRL(15075)).toBe('R$ 150,75');
    expect(formatCurrencyBRL(123456789)).toBe('R$ 1.234.567,89');
  });

  const vars: ReminderTemplateVars = {
    cliente: 'Ana',
    descricao: 'Mensalidade',
    valor: 'R$ 100,00',
    vencimento: '16/10/2026',
    nome_empresa: 'OrderUp',
  };

  it('renders the reminder template variables', () => {
    const result = renderReminderTemplate(
      'Oi {cliente}, {descricao} vale {valor} vence em {vencimento}. {nome_empresa}',
      vars,
    );
    expect(result).toBe('Oi Ana, Mensalidade vale R$ 100,00 vence em 16/10/2026. OrderUp');
  });

  it('renders the default template with every variable, preserving line breaks', () => {
    const result = renderReminderTemplate(BILLING_DEFAULT_MESSAGE_TEMPLATE, vars);
    expect(result).toContain('Olá, *Ana*! 👋');
    expect(result).toContain('📋 *Descrição:* Mensalidade');
    expect(result).toContain('💰 *Valor:* R$ 100,00');
    expect(result).toContain('📅 *Vencimento:* 16/10/2026');
    expect(result).toContain('*OrderUp*');
    expect(result).not.toContain('{');
    expect(result.split('\n').length).toBeGreaterThan(5);
  });

  it('keeps unknown placeholders untouched', () => {
    expect(renderReminderTemplate('{cliente} {desconhecido}', {
      ...vars,
      descricao: '',
      valor: '',
      vencimento: '',
    })).toBe('Ana {desconhecido}');
  });

  it('normalizes reminder offsets deterministically', () => {
    expect(normalizeReminderOffsets([0, -3, 3, -3, 0])).toEqual([-3, 0, 3]);
    expect(normalizeReminderOffsets(['x', 1.5, 400, 2])).toEqual([2]);
    expect(normalizeReminderOffsets(undefined)).toEqual([-3, 0, 3]);
  });
});
