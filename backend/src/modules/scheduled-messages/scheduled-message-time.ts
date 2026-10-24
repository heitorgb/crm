const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export type ScheduledRecurrence = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface RecurringSchedule {
  weekdays: readonly number[];
  dayOfMonth: number | null;
  recurringTime: string;
}

export function parseLocalDateTime(value: string): LocalParts | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59
  ) {
    return null;
  }
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return parts;
}

/** Validates a recurring clock time in `HH:mm` format. */
export function parseTimeOfDay(value: unknown): string | null {
  if (typeof value !== 'string' || !TIME_OF_DAY_PATTERN.test(value)) {
    return null;
  }
  return value;
}

/** Validates the configured day of month (1..31), accepting numeric strings. */
export function parseDayOfMonth(value: unknown): number | null {
  const numeric =
    typeof value === 'string' && value.trim().length > 0 ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 1 || numeric > 31) {
    return null;
  }
  return numeric;
}

/** Converts a local `YYYY-MM-DDTHH:mm` in the given IANA zone to a UTC instant. */
export function zonedTimeToUtc(value: string, timeZone: string): Date | null {
  const parts = parseLocalDateTime(value);
  if (!parts) {
    return null;
  }

  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let offset = timeZoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - offset;
  const secondOffset = timeZoneOffsetMs(new Date(utc), timeZone);
  if (secondOffset !== offset) {
    offset = secondOffset;
    utc = guess - offset;
  }
  return new Date(utc);
}

export function isFutureLocalDateTime(value: string, timeZone: string, now = new Date()): boolean {
  const date = zonedTimeToUtc(value, timeZone);
  return date !== null && date.getTime() > now.getTime();
}

export function localTimeOf(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function localDayOfMonth(date: Date, timeZone: string): number {
  return localParts(date, timeZone).day;
}

export function localIsoWeekday(date: Date, timeZone: string): number {
  return isoWeekdayOfParts(localParts(date, timeZone));
}

/**
 * Calculates the first future occurrence for a recurring schedule from `now`,
 * respecting the selected weekdays or configured day of month and local time.
 */
export function nextRecurringOccurrence(
  recurrence: ScheduledRecurrence,
  config: RecurringSchedule,
  timeZone: string,
  now = new Date(),
): Date | null {
  const time = parseTimeOfDay(config.recurringTime);
  if (!time) {
    return null;
  }

  const nowParts = localParts(now, timeZone);

  if (recurrence === 'DAILY' || recurrence === 'WEEKLY') {
    const allowed =
      config.weekdays.length > 0
        ? new Set(config.weekdays)
        : recurrence === 'DAILY'
          ? new Set(ALL_WEEKDAYS)
          : new Set<number>();
    if (allowed.size === 0) {
      return null;
    }

    for (let offset = 0; offset <= 7; offset += 1) {
      const candidateDate = new Date(
        Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + offset),
      );
      if (!allowed.has(isoWeekday(candidateDate))) {
        continue;
      }
      const candidate = zonedTimeToUtc(
        `${localDateString(candidateDate)}T${time}`,
        timeZone,
      );
      if (candidate && candidate.getTime() > now.getTime()) {
        return candidate;
      }
    }
    return null;
  }

  if (recurrence === 'MONTHLY') {
    if (config.dayOfMonth === null) {
      return null;
    }
    for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
      const totalMonths = nowParts.month - 1 + monthOffset;
      const year = nowParts.year + Math.floor(totalMonths / 12);
      const month = ((totalMonths % 12) + 12) % 12;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const day = Math.min(config.dayOfMonth, lastDay);
      const candidate = zonedTimeToUtc(
        `${localDateString(new Date(Date.UTC(year, month, day)))}T${time}`,
        timeZone,
      );
      if (candidate && candidate.getTime() > now.getTime()) {
        return candidate;
      }
    }
  }

  return null;
}

export function addRecurrence(
  current: Date,
  recurrence: ScheduledRecurrence,
  timeZone: string,
  weekdays: readonly number[] = [],
  dayOfMonth: number | null = null,
  recurringTime: string | null = null,
): Date {
  if (recurrence === 'ONCE') {
    return current;
  }

  const parts = localParts(current, timeZone);
  const time = parseTimeOfDay(recurringTime) ?? `${pad(parts.hour)}:${pad(parts.minute)}`;
  const local = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (recurrence === 'DAILY' || recurrence === 'WEEKLY') {
    const allowed =
      weekdays.length > 0
        ? new Set(weekdays)
        : recurrence === 'DAILY'
          ? new Set(ALL_WEEKDAYS)
          : new Set([isoWeekdayOfParts(parts)]);
    local.setUTCDate(local.getUTCDate() + nextWeekdayOffset(parts, allowed));
  } else {
    const totalMonths = parts.month - 1 + 1;
    const year = parts.year + Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const configuredDay = dayOfMonth ?? parts.day;
    local.setUTCFullYear(year, month, Math.min(configuredDay, lastDay));
  }

  const nextLocal = `${localDateString(local)}T${time}`;
  return zonedTimeToUtc(nextLocal, timeZone) ?? current;
}

export function addDaysLocal(value: string, days: number): string {
  const parts = parseLocalDateTime(value);
  if (!parts) {
    return value;
  }
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${localDateString(date)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function toLocalDateTimeString(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${localDateString(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
  )}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function nextWeekdayOffset(parts: LocalParts, allowed: ReadonlySet<number>): number {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
    if (allowed.has(isoWeekday(candidate))) {
      return offset;
    }
  }
  return 1;
}

function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function isoWeekdayOfParts(parts: LocalParts): number {
  return isoWeekday(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

function localDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  return {
    year: Number(part(parts, 'year')),
    month: Number(part(parts, 'month')),
    day: Number(part(parts, 'day')),
    hour: Number(part(parts, 'hour')),
    minute: Number(part(parts, 'minute')),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const asUtc = Date.UTC(
    Number(part(parts, 'year')),
    Number(part(parts, 'month')) - 1,
    Number(part(parts, 'day')),
    Number(part(parts, 'hour')),
    Number(part(parts, 'minute')),
    Number(part(parts, 'second')),
  );
  return asUtc - date.getTime();
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  const found = parts.find((item) => item.type === type)?.value;
  if (!found) {
    throw new Error(`Missing date part "${type}"`);
  }
  return found;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
