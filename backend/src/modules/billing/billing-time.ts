const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && formatDateOnly(date) === value;
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Formats a date as `DD/MM/YYYY`, the Brazilian format expected on WhatsApp. */
export function formatDateBR(date: Date): string {
  const [year, month, day] = formatDateOnly(date).split('-');
  return `${day}/${month}/${year}`;
}

/** Calendar date (YYYY-MM-DD) of an instant as seen in the given IANA time zone. */
export function localDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** Hour of the day (0-23) of an instant as seen in the given IANA time zone. */
export function localHour(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return Number.parseInt(part(parts, 'hour'), 10) % 24;
}

/**
 * UTC instant of 00:00 of a calendar date as seen in the given IANA time zone.
 * Used to filter timestamp columns (e.g. `paidAt`) by the tenant's local days.
 */
export function startOfDayInTimeZone(dateOnly: string, timeZone: string): Date {
  const date = parseDateOnly(dateOnly);
  const firstOffset = timeZoneOffset(date, timeZone);
  const refinedOffset = timeZoneOffset(new Date(date.getTime() - firstOffset), timeZone);
  return new Date(date.getTime() - refinedOffset);
}

function timeZoneOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const wallClockAsUtc = Date.UTC(
    Number(part(parts, 'year')),
    Number(part(parts, 'month')) - 1,
    Number(part(parts, 'day')),
    Number(part(parts, 'hour')),
    Number(part(parts, 'minute')),
    Number(part(parts, 'second')),
  );

  return wallClockAsUtc - instant.getTime();
}

export function addDays(dateOnly: string, days: number): string {
  const date = parseDateOnly(dateOnly);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

/**
 * Whether an hour (0-23) falls inside the configured send window. When start
 * equals end the window is treated as open the whole day; when start is after
 * end the window crosses midnight (e.g. 22h-6h). Both bounds are inclusive.
 */
export function isWithinWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) {
    return true;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour <= endHour;
  }
  return hour >= startHour || hour <= endHour;
}

/** Adds months clamping the day to the last valid day of the resulting month. */
export function addMonthsClamped(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const totalMonths = month - 1 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);

  const yearString = String(targetYear).padStart(4, '0');
  const monthString = String(targetMonth + 1).padStart(2, '0');
  const dayString = String(targetDay).padStart(2, '0');
  return `${yearString}-${monthString}-${dayString}`;
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
): string {
  const found = parts.find((item) => item.type === type)?.value;
  if (!found) {
    throw new Error(`Missing date part "${type}" while formatting`);
  }
  return found;
}
