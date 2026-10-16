import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  isValidDateOnly,
  parseDateOnly,
  formatDateOnly,
} from '../../../src/modules/billing/billing-time.js';
import {
  formatCurrencyBRL,
  normalizeReminderOffsets,
  renderReminderTemplate,
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
});

describe('billing-message', () => {
  it('formats cents as BRL without floating point artefacts', () => {
    expect(formatCurrencyBRL(0)).toBe('R$ 0,00');
    expect(formatCurrencyBRL(5)).toBe('R$ 0,05');
    expect(formatCurrencyBRL(15075)).toBe('R$ 150,75');
    expect(formatCurrencyBRL(123456789)).toBe('R$ 1.234.567,89');
  });

  it('renders the reminder template variables', () => {
    const result = renderReminderTemplate(
      'Oi {cliente}, {descricao} vale {valor} vence em {vencimento}.',
      {
        cliente: 'Ana',
        descricao: 'Mensalidade',
        valor: 'R$ 100,00',
        vencimento: '2026-10-16',
      },
    );
    expect(result).toBe('Oi Ana, Mensalidade vale R$ 100,00 vence em 2026-10-16.');
  });

  it('keeps unknown placeholders untouched', () => {
    expect(renderReminderTemplate('{cliente} {desconhecido}', {
      cliente: 'Ana',
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
