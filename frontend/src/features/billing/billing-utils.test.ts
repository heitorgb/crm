import { describe, expect, it } from 'vitest';
import {
  centsToInput,
  chargeStatusLabel,
  formatCurrency,
  offsetLabel,
  parseCurrencyToCents,
  parseOffsets,
  reminderStatusLabel,
  resolveBillingError,
  serializeOffsets,
} from './billing-utils';

describe('billing-utils', () => {
  it('formats cents as BRL', () => {
    expect(formatCurrency(0)).toBe('R$ 0,00');
    expect(formatCurrency(5)).toBe('R$ 0,05');
    expect(formatCurrency(15075)).toBe('R$ 150,75');
    expect(formatCurrency(123456789)).toBe('R$ 1.234.567,89');
  });

  it('parses BRL amounts into cents', () => {
    expect(parseCurrencyToCents('150,75')).toBe(15075);
    expect(parseCurrencyToCents('1.234,56')).toBe(123456);
    expect(parseCurrencyToCents('150.75')).toBe(15075);
    expect(parseCurrencyToCents('R$ 10')).toBe(1000);
    expect(parseCurrencyToCents('')).toBeNull();
    expect(parseCurrencyToCents('abc')).toBeNull();
    expect(parseCurrencyToCents('-5')).toBeNull();
  });

  it('round-trips cents to input value', () => {
    expect(centsToInput(15075)).toBe('150,75');
    expect(centsToInput(5)).toBe('0,05');
    expect(centsToInput(100000)).toBe('1000,00');
  });

  it('serializes and parses reminder offsets', () => {
    expect(serializeOffsets([3, -3, 0])).toBe('-3, 0, 3');
    expect(parseOffsets('-3, 0, 3')).toEqual([-3, 0, 3]);
    expect(parseOffsets('')).toEqual([]);
    expect(parseOffsets('a, b')).toBeNull();
    expect(parseOffsets('1.5')).toBeNull();
  });

  it('labels statuses and offsets', () => {
    expect(chargeStatusLabel('OVERDUE')).toBe('Vencida');
    expect(reminderStatusLabel('SKIPPED')).toBe('Ignorado');
    expect(offsetLabel(0)).toBe('No vencimento');
    expect(offsetLabel(-3)).toBe('3 dia(s) antes');
    expect(offsetLabel(2)).toBe('2 dia(s) depois');
  });

  it('treats a 403 as a permission error and preserves other messages', () => {
    const forbidden = Object.assign(new Error('Insufficient role for this operation'), {
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(resolveBillingError(forbidden, 'fallback')).toBe(
      'Você não tem permissão para esta operação.',
    );

    const conflict = Object.assign(new Error('Cobrança não encontrada'), { status: 404 });
    expect(resolveBillingError(conflict, 'fallback')).toBe('Cobrança não encontrada');

    expect(resolveBillingError('unexpected', 'fallback')).toBe('fallback');
  });
});
