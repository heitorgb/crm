import {
  BILLING_DEFAULT_REMINDER_OFFSETS,
  BILLING_MAX_REMINDER_OFFSET_DAYS,
  BILLING_MAX_REMINDER_OFFSETS,
  BILLING_REMINDER_BACKOFF_BASE_MS,
  BILLING_REMINDER_BACKOFF_MAX_MS,
} from './billing.constants.js';

export interface ReminderTemplateVars {
  cliente: string;
  descricao: string;
  valor: string;
  vencimento: string;
}

export function formatCurrencyBRL(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const reais = Math.floor(absolute / 100);
  const centavos = absolute % 100;
  return `${sign}R$ ${reais.toLocaleString('pt-BR')},${String(centavos).padStart(2, '0')}`;
}

export function renderReminderTemplate(template: string, vars: ReminderTemplateVars): string {
  return template.replace(
    /\{(cliente|descricao|valor|vencimento)\}/g,
    (_match, key: keyof ReminderTemplateVars) => vars[key],
  );
}

export function normalizeReminderOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [...BILLING_DEFAULT_REMINDER_OFFSETS];
  }

  const unique = new Set<number>();
  for (const item of value) {
    if (
      typeof item === 'number' &&
      Number.isInteger(item) &&
      Math.abs(item) <= BILLING_MAX_REMINDER_OFFSET_DAYS
    ) {
      unique.add(item);
    }
  }

  return [...unique].sort((a, b) => a - b).slice(0, BILLING_MAX_REMINDER_OFFSETS);
}

export function backoffDelayMs(attempt: number): number {
  return Math.min(
    BILLING_REMINDER_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
    BILLING_REMINDER_BACKOFF_MAX_MS,
  );
}
