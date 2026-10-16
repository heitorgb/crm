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

export function addDays(dateOnly: string, days: number): string {
  const date = parseDateOnly(dateOnly);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
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

function part(parts: Intl.DateTimeFormatPart[], type: 'year' | 'month' | 'day' | 'hour'): string {
  const found = parts.find((item) => item.type === type)?.value;
  if (!found) {
    throw new Error(`Missing date part "${type}" while formatting`);
  }
  return found;
}
