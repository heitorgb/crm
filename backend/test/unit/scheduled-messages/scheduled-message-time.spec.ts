import { describe, expect, it } from 'vitest';
import {
  addRecurrence,
  isFutureLocalDateTime,
  toLocalDateTimeString,
  zonedTimeToUtc,
} from '../../../src/modules/scheduled-messages/scheduled-message-time.js';
import { renderScheduledMessage } from '../../../src/modules/scheduled-messages/scheduled-message-render.js';

const TIME_ZONE = 'America/Sao_Paulo';

describe('scheduled message time', () => {
  it('converts a local Sao Paulo time to UTC', () => {
    const date = zonedTimeToUtc('2026-10-20T10:00', TIME_ZONE);
    expect(date?.toISOString()).toBe('2026-10-20T13:00:00.000Z');
    expect(toLocalDateTimeString(date as Date, TIME_ZONE)).toBe('2026-10-20T10:00');
  });

  it('rejects past local date-times', () => {
    const now = new Date('2026-10-20T13:00:00.000Z');
    expect(isFutureLocalDateTime('2026-10-20T09:59', TIME_ZONE, now)).toBe(false);
    expect(isFutureLocalDateTime('2026-10-20T10:01', TIME_ZONE, now)).toBe(true);
  });

  it('advances daily and monthly recurrences in the local timezone', () => {
    const first = zonedTimeToUtc('2026-10-20T10:00', TIME_ZONE) as Date;
    const nextDay = addRecurrence(first, 'DAILY', TIME_ZONE);
    expect(toLocalDateTimeString(nextDay, TIME_ZONE)).toBe('2026-10-21T10:00');

    const january31 = zonedTimeToUtc('2026-01-31T18:30', TIME_ZONE) as Date;
    const february = addRecurrence(january31, 'MONTHLY', TIME_ZONE);
    expect(toLocalDateTimeString(february, TIME_ZONE)).toBe('2026-02-28T18:30');
  });

  it('renders the supported variables and keeps unknown tokens', () => {
    expect(
      renderScheduledMessage('Olá, {nome} de {empresa}. Valor: {valor}. {outro}', {
        nome: 'Maria',
        empresa: 'OrderUp',
        valor: 'R$ 10,00',
      }),
    ).toBe('Olá, Maria de OrderUp. Valor: R$ 10,00. {outro}');
  });
});
