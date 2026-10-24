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

export function scheduleRecurrenceSummary(schedule: {
  recurrence: ScheduledMessageRecurrence;
  weekdays: number[];
  timeZone: string;
  scheduledAt: string;
  nextRunAt: string | null;
}): string {
  if (schedule.recurrence !== 'DAILY') {
    return recurrenceLabel[schedule.recurrence];
  }
  const days = weekdaysLabel(schedule.weekdays);
  const time = formatTimeInTimeZone(schedule.nextRunAt ?? schedule.scheduledAt, schedule.timeZone);
  return `${days} · ${time}`;
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
