import { ScheduledMessageInvalidWeekdaysError } from './scheduled-messages.errors.js';
import type { ScheduledRecurrence } from './scheduled-message-time.js';

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type ScheduledWeekday = (typeof ALL_WEEKDAYS)[number];

const WEEKDAY_RECURRENCES: readonly ScheduledRecurrence[] = ['DAILY', 'WEEKLY'];

export function usesWeekdays(recurrence: ScheduledRecurrence): boolean {
  return WEEKDAY_RECURRENCES.includes(recurrence);
}

export function parseWeekdays(value: unknown): ScheduledWeekday[] {
  if (!Array.isArray(value)) {
    throw new ScheduledMessageInvalidWeekdaysError('Formato de dias da semana inválido.');
  }
  if (value.length === 0) {
    throw new ScheduledMessageInvalidWeekdaysError();
  }

  const seen = new Set<number>();
  const days: ScheduledWeekday[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > 7) {
      throw new ScheduledMessageInvalidWeekdaysError('Dia da semana inválido.');
    }
    if (seen.has(item)) {
      throw new ScheduledMessageInvalidWeekdaysError('Não repita o mesmo dia da semana.');
    }
    seen.add(item);
    days.push(item as ScheduledWeekday);
  }

  return days.sort((left, right) => left - right);
}

export function resolveWeekdays(
  recurrence: ScheduledRecurrence,
  value: unknown,
): ScheduledWeekday[] {
  if (!usesWeekdays(recurrence)) {
    return [];
  }
  return parseWeekdays(value);
}

export function sameWeekdays(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((day, index) => day === sortedRight[index]);
}
