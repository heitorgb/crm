const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export type ScheduledRecurrence = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

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

export function addRecurrence(
  current: Date,
  recurrence: ScheduledRecurrence,
  timeZone: string,
  weekdays: readonly number[] = [],
): Date {
  if (recurrence === 'ONCE') {
    return current;
  }

  const parts = localParts(current, timeZone);
  const local = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (recurrence === 'DAILY') {
    const allowed = new Set(weekdays);
    let offset = 1;
    if (allowed.size > 0) {
      while (offset <= 7) {
        const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
        if (allowed.has(isoWeekday(candidate))) {
          break;
        }
        offset += 1;
      }
      if (offset > 7) {
        offset = 1;
      }
    }
    local.setUTCDate(local.getUTCDate() + offset);
  } else if (recurrence === 'WEEKLY') {
    local.setUTCDate(local.getUTCDate() + 7);
  } else {
    const totalMonths = parts.month - 1 + 1;
    const year = parts.year + Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(parts.day, lastDay);
    local.setUTCFullYear(year, month, day);
  }

  const nextLocal = `${pad(local.getUTCFullYear())}-${pad(local.getUTCMonth() + 1)}-${pad(
    local.getUTCDate(),
  )}T${pad(parts.hour)}:${pad(parts.minute)}`;
  return zonedTimeToUtc(nextLocal, timeZone) ?? current;
}

export function addDaysLocal(value: string, days: number): string {
  const parts = parseLocalDateTime(value);
  if (!parts) {
    return value;
  }
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${pad(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function toLocalDateTimeString(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${pad(parts.year)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(
    parts.minute,
  )}`;
}

function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
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
