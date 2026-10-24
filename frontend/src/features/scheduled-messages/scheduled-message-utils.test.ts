import { describe, expect, it } from 'vitest';
import {
  formatTimeInTimeZone,
  scheduleRecurrenceSummary,
  weekdaysLabel,
} from './scheduled-message-utils';

const baseSchedule = {
  recurrence: 'DAILY' as const,
  weekdays: [1, 3, 5],
  timeZone: 'America/Sao_Paulo',
  scheduledAt: '2026-10-19T12:00:00.000Z',
  nextRunAt: '2026-10-21T12:00:00.000Z',
};

describe('scheduled message weekday helpers', () => {
  it('formats selected weekdays in ISO order with a Portuguese conjunction', () => {
    expect(weekdaysLabel([5, 1, 3])).toBe('Segunda, quarta e sexta');
    expect(weekdaysLabel([1])).toBe('Segunda');
    expect(weekdaysLabel([1, 2])).toBe('Segunda e terça');
  });

  it('treats a legacy empty selection as every day', () => {
    expect(weekdaysLabel([])).toBe('Todos os dias');
  });

  it('combines weekdays with the configured local time', () => {
    expect(scheduleRecurrenceSummary(baseSchedule)).toBe('Segunda, quarta e sexta · 09:00');
  });

  it('falls back to the first scheduled time when there is no next run', () => {
    expect(scheduleRecurrenceSummary({ ...baseSchedule, nextRunAt: null })).toBe(
      'Segunda, quarta e sexta · 09:00',
    );
  });

  it('keeps the other recurrence labels unchanged', () => {
    expect(
      scheduleRecurrenceSummary({
        ...baseSchedule,
        recurrence: 'ONCE',
        weekdays: [],
      }),
    ).toBe('Única');
    expect(
      scheduleRecurrenceSummary({
        ...baseSchedule,
        recurrence: 'WEEKLY',
        weekdays: [],
      }),
    ).toBe('Semanal');
    expect(
      scheduleRecurrenceSummary({
        ...baseSchedule,
        recurrence: 'MONTHLY',
        weekdays: [],
      }),
    ).toBe('Mensal');
  });

  it('formats times in the schedule timezone', () => {
    expect(formatTimeInTimeZone('2026-10-19T12:00:00.000Z', 'America/Sao_Paulo')).toBe('09:00');
  });
});
