import { describe, expect, it } from 'vitest';
import {
  dayOfMonthOfLocalInput,
  formatTimeInTimeZone,
  isFutureLocalDateTime,
  isoWeekdayOfLocalInput,
  isValidDayOfMonth,
  isValidTimeOfDay,
  localDateTimeToUtc,
  localDayOfMonthOf,
  localIsoWeekdayOf,
  localTimeInput,
  scheduleRecurrenceSummary,
  weekdaysLabel,
} from './scheduled-message-utils';

const baseSchedule = {
  recurrence: 'DAILY' as const,
  weekdays: [1, 3, 5],
  dayOfMonth: null,
  recurringTime: '09:00' as string | null,
  timeZone: 'America/Sao_Paulo',
  scheduledAt: '2026-10-19T12:00:00.000Z',
  nextRunAt: '2026-10-21T12:00:00.000Z' as string | null,
};

describe('scheduled message weekday helpers', () => {
  it('formats selected weekdays in ISO order with a Portuguese conjunction', () => {
    expect(weekdaysLabel([5, 1, 3])).toBe('Segunda, quarta e sexta');
    expect(weekdaysLabel([1])).toBe('Segunda');
    expect(weekdaysLabel([1, 2])).toBe('Segunda e terça');
  });

  it('treats a legacy empty daily selection as every day', () => {
    expect(weekdaysLabel([])).toBe('Todos os dias');
  });

  it('combines weekdays with the configured recurring time', () => {
    expect(scheduleRecurrenceSummary(baseSchedule)).toBe('Segunda, quarta e sexta · 09:00');
  });

  it('falls back to the first scheduled time when there is no next run', () => {
    expect(
      scheduleRecurrenceSummary({ ...baseSchedule, nextRunAt: null, recurringTime: null }),
    ).toBe('Segunda, quarta e sexta · 09:00');
  });

  it('summarizes weekly schedules with every selected day', () => {
    expect(
      scheduleRecurrenceSummary({ ...baseSchedule, recurrence: 'WEEKLY', weekdays: [4, 2] }),
    ).toBe('Terça e quinta · 09:00');
  });

  it('summarizes legacy weekly schedules using the weekday of the next run', () => {
    expect(
      scheduleRecurrenceSummary({ ...baseSchedule, recurrence: 'WEEKLY', weekdays: [] }),
    ).toBe('Quarta · 09:00');
  });

  it('summarizes monthly schedules with the configured day', () => {
    expect(
      scheduleRecurrenceSummary({ ...baseSchedule, recurrence: 'MONTHLY', weekdays: [], dayOfMonth: 31 }),
    ).toBe('Todo dia 31 · 09:00');
  });

  it('summarizes legacy monthly schedules using the first execution day', () => {
    expect(
      scheduleRecurrenceSummary({
        ...baseSchedule,
        recurrence: 'MONTHLY',
        weekdays: [],
        dayOfMonth: null,
      }),
    ).toBe('Todo dia 19 · 09:00');
  });

  it('keeps the one-time label unchanged', () => {
    expect(
      scheduleRecurrenceSummary({
        ...baseSchedule,
        recurrence: 'ONCE',
        weekdays: [],
        recurringTime: null,
      }),
    ).toBe('Única');
  });

  it('formats times in the schedule timezone', () => {
    expect(formatTimeInTimeZone('2026-10-19T12:00:00.000Z', 'America/Sao_Paulo')).toBe('09:00');
  });
});

describe('scheduled message local date helpers', () => {
  it('extracts the local time, day and ISO weekday', () => {
    expect(localTimeInput('2026-10-19T12:00:00.000Z', 'America/Sao_Paulo')).toBe('09:00');
    expect(localDayOfMonthOf('2026-10-19T12:00:00.000Z', 'America/Sao_Paulo')).toBe(19);
    expect(localIsoWeekdayOf('2026-10-19T12:00:00.000Z', 'America/Sao_Paulo')).toBe(1);
    expect(localDayOfMonthOf('2026-11-01T02:00:00.000Z', 'America/Sao_Paulo')).toBe(31);
  });

  it('reads weekdays and days from a local input value', () => {
    expect(isoWeekdayOfLocalInput('2026-10-19T09:00')).toBe(1);
    expect(isoWeekdayOfLocalInput('2026-10-25T09:00')).toBe(7);
    expect(dayOfMonthOfLocalInput('2026-10-19T09:00')).toBe(19);
  });

  it('validates recurring time and monthly day inputs', () => {
    expect(isValidTimeOfDay('09:30')).toBe(true);
    expect(isValidTimeOfDay('24:00')).toBe(false);
    expect(isValidTimeOfDay('9:30')).toBe(false);
    expect(isValidDayOfMonth('1')).toBe(true);
    expect(isValidDayOfMonth('31')).toBe(true);
    expect(isValidDayOfMonth('0')).toBe(false);
    expect(isValidDayOfMonth('32')).toBe(false);
    expect(isValidDayOfMonth('')).toBe(false);
    expect(isValidDayOfMonth('1.5')).toBe(false);
  });

  it('converts local input to UTC and checks the future', () => {
    const date = localDateTimeToUtc('2026-10-20T10:00', 'America/Sao_Paulo');
    expect(date?.toISOString()).toBe('2026-10-20T13:00:00.000Z');
    const now = new Date('2026-10-20T13:00:00.000Z');
    expect(isFutureLocalDateTime('2026-10-20T09:59', 'America/Sao_Paulo', now)).toBe(false);
    expect(isFutureLocalDateTime('2026-10-20T10:01', 'America/Sao_Paulo', now)).toBe(true);
  });
});
