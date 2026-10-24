import type { StatusTone } from '@/components/common/status-badge';
import type {
  ScheduledMessageRecurrence,
  ScheduledMessageRecipientStatus,
  ScheduledMessageStatus,
  ScheduledMessageType,
} from '@/types/scheduled-messages';

export const scheduledTypeLabel: Record<ScheduledMessageType, string> = {
  CAMPAIGN: 'Campanha',
  REMINDER: 'Lembrete',
};

export const scheduledTypeTone: Record<ScheduledMessageType, StatusTone> = {
  CAMPAIGN: 'info',
  REMINDER: 'warning',
};

export const scheduledStatusLabel: Record<ScheduledMessageStatus, string> = {
  SCHEDULED: 'Agendada',
  PROCESSING: 'Enviando',
  SENT: 'Enviada',
  FAILED: 'Falhou',
  CANCELED: 'Cancelada',
};

export const scheduledStatusTone: Record<ScheduledMessageStatus, StatusTone> = {
  SCHEDULED: 'info',
  PROCESSING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  CANCELED: 'secondary',
};

export const scheduledRecipientStatusLabel: Record<
  ScheduledMessageRecipientStatus,
  string
> = {
  PENDING: 'Pendente',
  PROCESSING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorado',
};

export const scheduledRecipientStatusTone: Record<
  ScheduledMessageRecipientStatus,
  StatusTone
> = {
  PENDING: 'secondary',
  PROCESSING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'secondary',
};

export const recurrenceLabel: Record<ScheduledMessageRecurrence, string> = {
  ONCE: 'Única',
  DAILY: 'Diária',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
};

export interface ScheduledWeekdayOption {
  value: number;
  label: string;
  shortLabel: string;
}

export const scheduledWeekdays: readonly ScheduledWeekdayOption[] = [
  { value: 1, label: 'Segunda-feira', shortLabel: 'Segunda' },
  { value: 2, label: 'Terça-feira', shortLabel: 'Terça' },
  { value: 3, label: 'Quarta-feira', shortLabel: 'Quarta' },
  { value: 4, label: 'Quinta-feira', shortLabel: 'Quinta' },
  { value: 5, label: 'Sexta-feira', shortLabel: 'Sexta' },
  { value: 6, label: 'Sábado', shortLabel: 'Sábado' },
  { value: 7, label: 'Domingo', shortLabel: 'Domingo' },
];

export const ALL_WEEKDAYS = scheduledWeekdays.map((day) => day.value);

export const SCHEDULED_MESSAGE_TIMEZONE = 'America/Sao_Paulo';

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

export function isValidDayOfMonth(value: string): boolean {
  const numeric = Number(value);
  return value.trim().length > 0 && Number.isInteger(numeric) && numeric >= 1 && numeric <= 31;
}

export function weekdaysLabel(weekdays: number[]): string {
  const labels = scheduledWeekdays
    .filter((day) => weekdays.includes(day.value))
    .map((day) => day.shortLabel);
  if (labels.length === 0) {
    return 'Todos os dias';
  }
  if (labels.length === 1) {
    return labels[0];
  }
  const sentence = labels.map((label, index) =>
    index === 0 ? label : label.charAt(0).toLocaleLowerCase('pt-BR') + label.slice(1),
  );
  return `${sentence.slice(0, -1).join(', ')} e ${sentence[sentence.length - 1]}`;
}

export function formatTimeInTimeZone(value: string | Date, timeZone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function localTimeInput(value: string | Date, timeZone: string): string {
  return toLocalInput(value, timeZone).slice(11, 16);
}

export function localDayOfMonthOf(value: string | Date, timeZone: string): number {
  return Number(toLocalInput(value, timeZone).slice(8, 10));
}

export function localIsoWeekdayOf(value: string | Date, timeZone: string): number {
  return isoWeekdayOfLocalInput(toLocalInput(value, timeZone));
}

export function isoWeekdayOfLocalInput(value: string): number {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function dayOfMonthOfLocalInput(value: string): number {
  return Number(value.slice(8, 10));
}

export function localDateTimeToUtc(value: string, timeZone: string): Date | null {
  const parts = parseLocalInput(value);
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

export function isFutureLocalDateTime(
  value: string,
  timeZone: string,
  now = new Date(),
): boolean {
  const date = localDateTimeToUtc(value, timeZone);
  return date !== null && date.getTime() > now.getTime();
}

interface LocalInputParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseLocalInput(value: string): LocalInputParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
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
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - date.getTime();
}

export function scheduleRecurrenceSummary(schedule: {
  recurrence: ScheduledMessageRecurrence;
  weekdays: number[];
  dayOfMonth: number | null;
  recurringTime: string | null;
  timeZone: string;
  scheduledAt: string;
  nextRunAt: string | null;
}): string {
  const occurrence = schedule.nextRunAt ?? schedule.scheduledAt;
  const time =
    schedule.recurringTime ?? localTimeInput(schedule.scheduledAt, schedule.timeZone);

  if (schedule.recurrence === 'ONCE') {
    return recurrenceLabel.ONCE;
  }
  if (schedule.recurrence === 'DAILY') {
    return `${weekdaysLabel(schedule.weekdays)} · ${time}`;
  }
  if (schedule.recurrence === 'WEEKLY') {
    const weekdays =
      schedule.weekdays.length > 0
        ? schedule.weekdays
        : [localIsoWeekdayOf(occurrence, schedule.timeZone)];
    return `${weekdaysLabel(weekdays)} · ${time}`;
  }

  const day = schedule.dayOfMonth ?? localDayOfMonthOf(schedule.scheduledAt, schedule.timeZone);
  return `Todo dia ${day} · ${time}`;
}

export function formatInTimeZone(value: string | Date, timeZone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function toLocalInput(value: string | Date, timeZone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
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
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function defaultLocalDateTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return toLocalInput(date, 'America/Sao_Paulo');
}

export function previewScheduledMessage(
  content: string,
  variables: { nome: string; empresa: string; valor: string },
): string {
  return content.replace(
    /\{(nome|empresa|valor)\}/g,
    (_match, key: keyof typeof variables) => variables[key] ?? '',
  );
}
