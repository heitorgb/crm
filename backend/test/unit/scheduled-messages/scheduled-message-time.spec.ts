import { describe, expect, it } from 'vitest';
import {
  addRecurrence,
  isFutureLocalDateTime,
  localTimeOf,
  nextRecurringOccurrence,
  parseDayOfMonth,
  parseTimeOfDay,
  toLocalDateTimeString,
  zonedTimeToUtc,
} from '../../../src/modules/scheduled-messages/scheduled-message-time.js';
import {
  ALL_WEEKDAYS,
  parseWeekdays,
  resolveWeekdays,
  sameWeekdays,
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
    expect(localTimeOf(date as Date, TIME_ZONE)).toBe('10:00');
  });

  it('rejects past local date-times', () => {
    const now = new Date('2026-10-20T13:00:00.000Z');
    expect(isFutureLocalDateTime('2026-10-20T09:59', TIME_ZONE, now)).toBe(false);
    expect(isFutureLocalDateTime('2026-10-20T10:01', TIME_ZONE, now)).toBe(true);
  });

  it('parses recurring times and configured days of month', () => {
    expect(parseTimeOfDay('09:30')).toBe('09:30');
    expect(parseTimeOfDay('23:59')).toBe('23:59');
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('9:30')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();

    expect(parseDayOfMonth(1)).toBe(1);
    expect(parseDayOfMonth(31)).toBe(31);
    expect(parseDayOfMonth('15')).toBe(15);
    expect(parseDayOfMonth(0)).toBeNull();
    expect(parseDayOfMonth(32)).toBeNull();
    expect(parseDayOfMonth(1.5)).toBeNull();
    expect(parseDayOfMonth('')).toBeNull();
  });

  it('advances daily and monthly recurrences in the local timezone', () => {
    const first = localAt('2026-10-20T10:00');
    const nextDay = addRecurrence(first, 'DAILY', TIME_ZONE);
    expect(toLocalDateTimeString(nextDay, TIME_ZONE)).toBe('2026-10-21T10:00');

    const january31 = localAt('2026-01-31T18:30');
    const february = addRecurrence(january31, 'MONTHLY', TIME_ZONE, [], 31, '18:30');
    expect(toLocalDateTimeString(february, TIME_ZONE)).toBe('2026-02-28T18:30');
  });

  it('keeps ONCE semantics unchanged', () => {
    const monday = localAt('2026-10-19T09:00');
    expect(addRecurrence(monday, 'ONCE', TIME_ZONE, [3])).toBe(monday);
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

  it('advances daily recurrences to the next selected weekday', () => {
    const monday = localAt('2026-10-19T09:00');
    const wednesday = addRecurrence(monday, 'DAILY', TIME_ZONE, [1, 3, 5]);
    expect(toLocalDateTimeString(wednesday, TIME_ZONE)).toBe('2026-10-21T09:00');

    const friday = localAt('2026-10-23T09:00');
    const nextMonday = addRecurrence(friday, 'DAILY', TIME_ZONE, [1, 3, 5]);
    expect(toLocalDateTimeString(nextMonday, TIME_ZONE)).toBe('2026-10-26T09:00');
    expect(nextMonday.toISOString()).toBe('2026-10-26T12:00:00.000Z');
  });

  it('advances weekly recurrences to every selected weekday', () => {
    const monday = localAt('2026-10-19T09:00');
    const thursday = addRecurrence(monday, 'WEEKLY', TIME_ZONE, [1, 4]);
    expect(toLocalDateTimeString(thursday, TIME_ZONE)).toBe('2026-10-22T09:00');

    const followingMonday = addRecurrence(thursday, 'WEEKLY', TIME_ZONE, [1, 4]);
    expect(toLocalDateTimeString(followingMonday, TIME_ZONE)).toBe('2026-10-26T09:00');
  });

  it('keeps a legacy WEEKLY schedule on the same weekday every week', () => {
    const monday = localAt('2026-10-19T09:00');
    const next = addRecurrence(monday, 'WEEKLY', TIME_ZONE, []);
    expect(toLocalDateTimeString(next, TIME_ZONE)).toBe('2026-10-26T09:00');
  });

  it('keeps the configured monthly day across 28, 29, 30 and 31 day months', () => {
    const january31 = localAt('2026-01-31T18:30');
    const february = addRecurrence(january31, 'MONTHLY', TIME_ZONE, [], 31, '18:30');
    const march = addRecurrence(february, 'MONTHLY', TIME_ZONE, [], 31, '18:30');
    const april = addRecurrence(march, 'MONTHLY', TIME_ZONE, [], 31, '18:30');
    const may = addRecurrence(april, 'MONTHLY', TIME_ZONE, [], 31, '18:30');

    expect(toLocalDateTimeString(february, TIME_ZONE)).toBe('2026-02-28T18:30');
    expect(toLocalDateTimeString(march, TIME_ZONE)).toBe('2026-03-31T18:30');
    expect(toLocalDateTimeString(april, TIME_ZONE)).toBe('2026-04-30T18:30');
    expect(toLocalDateTimeString(may, TIME_ZONE)).toBe('2026-05-31T18:30');

    const leapJanuary = localAt('2028-01-31T18:30');
    const leapFebruary = addRecurrence(leapJanuary, 'MONTHLY', TIME_ZONE, [], 31, '18:30');
    expect(toLocalDateTimeString(leapFebruary, TIME_ZONE)).toBe('2028-02-29T18:30');
  });

  it('preserves the original local hour and minute across recurrence', () => {
    const first = localAt('2026-10-19T18:45');
    const next = addRecurrence(first, 'DAILY', TIME_ZONE, [3], null, '18:45');
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

describe('first recurring occurrence', () => {
  it('finds the next selected weekday at the recurring time', () => {
    const mondayAt10 = new Date('2026-10-19T13:00:00.000Z');

    expect(
      nextRecurringOccurrence(
        'DAILY',
        { weekdays: [1, 3, 5], dayOfMonth: null, recurringTime: '09:00' },
        TIME_ZONE,
        mondayAt10,
      )?.toISOString(),
    ).toBe('2026-10-21T12:00:00.000Z');
  });

  it('allows today when the recurring time is still in the future', () => {
    const mondayAt08 = new Date('2026-10-19T11:00:00.000Z');

    expect(
      nextRecurringOccurrence(
        'DAILY',
        { weekdays: [1], dayOfMonth: null, recurringTime: '09:00' },
        TIME_ZONE,
        mondayAt08,
      )?.toISOString(),
    ).toBe('2026-10-19T12:00:00.000Z');
  });

  it('finds the next selected weekday for a weekly recurrence', () => {
    const mondayAt10 = new Date('2026-10-19T13:00:00.000Z');

    expect(
      nextRecurringOccurrence(
        'WEEKLY',
        { weekdays: [1, 4], dayOfMonth: null, recurringTime: '09:00' },
        TIME_ZONE,
        mondayAt10,
      )?.toISOString(),
    ).toBe('2026-10-22T12:00:00.000Z');
  });

  it('wraps weekly recurrences across the year boundary', () => {
    const thursdayAt10 = new Date('2026-12-31T13:00:00.000Z');

    expect(
      nextRecurringOccurrence(
        'WEEKLY',
        { weekdays: [1], dayOfMonth: null, recurringTime: '09:00' },
        TIME_ZONE,
        thursdayAt10,
      )?.toISOString(),
    ).toBe('2027-01-04T12:00:00.000Z');
  });

  it('uses the last day of short months for monthly schedules', () => {
    const firstOfFebruary = new Date('2026-02-01T12:00:00.000Z');
    expect(
      nextRecurringOccurrence(
        'MONTHLY',
        { weekdays: [], dayOfMonth: 31, recurringTime: '09:00' },
        TIME_ZONE,
        firstOfFebruary,
      )?.toISOString(),
    ).toBe('2026-02-28T12:00:00.000Z');

    const firstOfApril = new Date('2026-04-01T12:00:00.000Z');
    expect(
      nextRecurringOccurrence(
        'MONTHLY',
        { weekdays: [], dayOfMonth: 31, recurringTime: '09:00' },
        TIME_ZONE,
        firstOfApril,
      )?.toISOString(),
    ).toBe('2026-04-30T12:00:00.000Z');

    const firstOfLeapFebruary = new Date('2028-02-01T12:00:00.000Z');
    expect(
      nextRecurringOccurrence(
        'MONTHLY',
        { weekdays: [], dayOfMonth: 31, recurringTime: '09:00' },
        TIME_ZONE,
        firstOfLeapFebruary,
      )?.toISOString(),
    ).toBe('2028-02-29T12:00:00.000Z');
  });

  it('rolls a monthly occurrence into the next month after the configured time', () => {
    const endOfFebruaryAt10 = new Date('2026-02-28T13:00:00.000Z');

    expect(
      nextRecurringOccurrence(
        'MONTHLY',
        { weekdays: [], dayOfMonth: 31, recurringTime: '09:00' },
        TIME_ZONE,
        endOfFebruaryAt10,
      )?.toISOString(),
    ).toBe('2026-03-31T12:00:00.000Z');
  });

  it('returns null when a recurring schedule has no usable configuration', () => {
    const now = new Date('2026-10-19T13:00:00.000Z');
    expect(
      nextRecurringOccurrence(
        'WEEKLY',
        { weekdays: [], dayOfMonth: null, recurringTime: '09:00' },
        TIME_ZONE,
        now,
      ),
    ).toBeNull();
    expect(
      nextRecurringOccurrence(
        'MONTHLY',
        { weekdays: [], dayOfMonth: null, recurringTime: '09:00' },
        TIME_ZONE,
        now,
      ),
    ).toBeNull();
  });
});

describe('scheduled message weekdays', () => {
  it('accepts and orders the seven ISO weekdays', () => {
    expect(parseWeekdays([7, 1, 3, 2, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(parseWeekdays([1])).toEqual([1]);
  });

  it('requires an explicit selection for weekday-based recurrences', () => {
    expect(resolveWeekdays('DAILY', [3, 1])).toEqual([1, 3]);
    expect(resolveWeekdays('WEEKLY', [5, 1])).toEqual([1, 5]);
    expect(() => resolveWeekdays('DAILY', undefined)).toThrow(
      ScheduledMessageInvalidWeekdaysError,
    );
    expect(() => resolveWeekdays('DAILY', [])).toThrow(ScheduledMessageInvalidWeekdaysError);
    expect(() => resolveWeekdays('WEEKLY', [])).toThrow(ScheduledMessageInvalidWeekdaysError);
  });

  it('ignores weekdays for recurrences that do not use them', () => {
    expect(resolveWeekdays('ONCE', 'invalid')).toEqual([]);
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

  it('compares selections regardless of order', () => {
    expect(sameWeekdays([5, 1, 3], [1, 3, 5])).toBe(true);
    expect(sameWeekdays([1, 3], [1, 3, 5])).toBe(false);
  });
});
