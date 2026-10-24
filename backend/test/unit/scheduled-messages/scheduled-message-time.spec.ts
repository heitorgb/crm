import { describe, expect, it } from 'vitest';
import {
  addRecurrence,
  isFutureLocalDateTime,
  toLocalDateTimeString,
  zonedTimeToUtc,
} from '../../../src/modules/scheduled-messages/scheduled-message-time.js';
import {
  ALL_WEEKDAYS,
  parseWeekdays,
  resolveUpdatedWeekdays,
  resolveWeekdays,
} from '../../../src/modules/scheduled-messages/scheduled-message-weekdays.js';
import { ScheduledMessageInvalidWeekdaysError } from '../../../src/modules/scheduled-messages/scheduled-messages.errors.js';
import { renderScheduledMessage } from '../../../src/modules/scheduled-messages/scheduled-message-render.js';

const TIME_ZONE = 'America/Sao_Paulo';

function localAt(value: string): Date {
  return zonedTimeToUtc(value, TIME_ZONE) as Date;
}

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
    const first = localAt('2026-10-20T10:00');
    const nextDay = addRecurrence(first, 'DAILY', TIME_ZONE);
    expect(toLocalDateTimeString(nextDay, TIME_ZONE)).toBe('2026-10-21T10:00');

    const january31 = localAt('2026-01-31T18:30');
    const february = addRecurrence(january31, 'MONTHLY', TIME_ZONE);
    expect(toLocalDateTimeString(february, TIME_ZONE)).toBe('2026-02-28T18:30');
  });

  it('keeps ONCE, WEEKLY and MONTHLY semantics unchanged', () => {
    const monday = localAt('2026-10-19T09:00');
    expect(addRecurrence(monday, 'ONCE', TIME_ZONE, [3])).toBe(monday);

    const weekly = addRecurrence(monday, 'WEEKLY', TIME_ZONE, [3]);
    expect(toLocalDateTimeString(weekly, TIME_ZONE)).toBe('2026-10-26T09:00');

    const monthly = addRecurrence(monday, 'MONTHLY', TIME_ZONE, [3]);
    expect(toLocalDateTimeString(monthly, TIME_ZONE)).toBe('2026-11-19T09:00');
  });

  it('sends every day when a legacy DAILY schedule has no weekdays', () => {
    const monday = localAt('2026-10-19T09:00');
    const next = addRecurrence(monday, 'DAILY', TIME_ZONE, []);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-20T09:00');
  });

  it('sends on the next day when all seven weekdays are selected', () => {
    const monday = localAt('2026-10-19T09:00');
    const next = addRecurrence(monday, 'DAILY', TIME_ZONE, [...ALL_WEEKDAYS]);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-20T09:00');
    expect(next.toISOString()).toBe('2026-10-20T12:00:00.000Z');
  });

  it('advances to the next occurrence within the same week', () => {
    const monday = localAt('2026-10-19T09:00');
    const next = addRecurrence(monday, 'DAILY', TIME_ZONE, [1, 3, 5]);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-21T09:00');
  });

  it('advances to the following Monday after a Friday occurrence', () => {
    const friday = localAt('2026-10-23T09:00');
    const next = addRecurrence(friday, 'DAILY', TIME_ZONE, [1, 3, 5]);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-26T09:00');
    expect(next.toISOString()).toBe('2026-10-26T12:00:00.000Z');
  });

  it('moves from Sunday to Monday', () => {
    const sunday = localAt('2026-10-25T09:00');
    const next = addRecurrence(sunday, 'DAILY', TIME_ZONE, [1]);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-26T09:00');
  });

  it('waits a full week when the only selected day is today', () => {
    const monday = localAt('2026-10-19T09:00');
    const next = addRecurrence(monday, 'DAILY', TIME_ZONE, [1]);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-26T09:00');
  });

  it('preserves the original local hour and minute across recurrence', () => {
    const first = localAt('2026-10-19T18:45');
    const next = addRecurrence(first, 'DAILY', TIME_ZONE, [3]);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-21T18:45');
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

describe('scheduled message weekdays', () => {
  it('accepts and orders the seven ISO weekdays', () => {
    expect(parseWeekdays([7, 1, 3, 2, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('accepts a single weekday', () => {
    expect(parseWeekdays([1])).toEqual([1]);
  });

  it('defaults a new daily schedule without weekdays to every day', () => {
    expect(resolveWeekdays('DAILY', undefined)).toEqual([...ALL_WEEKDAYS]);
  });

  it('ignores weekdays for recurrences that do not use them', () => {
    expect(resolveWeekdays('ONCE', 'invalid')).toEqual([]);
    expect(resolveWeekdays('WEEKLY', [1, 3])).toEqual([]);
    expect(resolveWeekdays('MONTHLY', [1])).toEqual([]);
  });

  it('rejects empty, invalid and duplicated weekday selections', () => {
    expect(() => parseWeekdays([])).toThrow(ScheduledMessageInvalidWeekdaysError);
    expect(() => parseWeekdays([0])).toThrow(ScheduledMessageInvalidWeekdaysError);
    expect(() => parseWeekdays([8])).toThrow(ScheduledMessageInvalidWeekdaysError);
    expect(() => parseWeekdays([1.5])).toThrow(ScheduledMessageInvalidWeekdaysError);
    expect(() => parseWeekdays(['1'])).toThrow(ScheduledMessageInvalidWeekdaysError);
    expect(() => parseWeekdays([1, 1])).toThrow(ScheduledMessageInvalidWeekdaysError);
    expect(() => parseWeekdays('1,2,3')).toThrow(ScheduledMessageInvalidWeekdaysError);
  });

  it('preserves the stored selection when a daily schedule is edited', () => {
    expect(
      resolveUpdatedWeekdays('DAILY', undefined, {
        recurrence: 'DAILY',
        weekdays: [3, 1],
      }),
    ).toEqual([1, 3]);
  });

  it('preserves the legacy empty selection when a daily schedule is edited', () => {
    expect(
      resolveUpdatedWeekdays('DAILY', undefined, { recurrence: 'DAILY', weekdays: [] }),
    ).toEqual([]);
  });

  it('defaults to every day when switching another recurrence to daily', () => {
    expect(
      resolveUpdatedWeekdays('DAILY', undefined, { recurrence: 'WEEKLY', weekdays: [] }),
    ).toEqual([...ALL_WEEKDAYS]);
  });

  it('clears weekdays when the updated recurrence does not use them', () => {
    expect(
      resolveUpdatedWeekdays('WEEKLY', [1, 3], { recurrence: 'DAILY', weekdays: [1, 3] }),
    ).toEqual([]);
  });
});
