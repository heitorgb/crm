export const BILLING_DEFAULT_REMINDER_OFFSETS = [-3, 0, 3] as const;

export const BILLING_DEFAULT_MESSAGE_TEMPLATE =
  'Olá {cliente}! Passando para lembrar da cobrança "{descricao}" no valor de {valor}, com vencimento em {vencimento}.';

export const BILLING_DEFAULT_SEND_WINDOW_START_HOUR = 9;
export const BILLING_DEFAULT_SEND_WINDOW_END_HOUR = 18;

export const BILLING_MAX_REMINDER_OFFSETS = 10;
export const BILLING_MAX_REMINDER_OFFSET_DAYS = 365;

export const BILLING_MAX_REMINDER_ATTEMPTS = 3;
export const BILLING_REMINDER_BACKOFF_BASE_MS = 5 * 60 * 1000;
export const BILLING_REMINDER_BACKOFF_MAX_MS = 60 * 60 * 1000;
export const BILLING_STALE_PROCESSING_MS = 15 * 60 * 1000;

/** The periodic scan generates charges/reminders and dispatches pending reminders. */
export const BILLING_SCAN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How many days in the past a missed reminder is still generated for. Bounds the
 * catch-up after a scan outage so a short downtime does not lose an eligible
 * reminder, while avoiding a flood of reminders for long-overdue charges.
 */
export const BILLING_REMINDER_CATCHUP_DAYS = 2;

/** Upper bound of recurrence catch-up iterations executed in a single scan. */
export const BILLING_MAX_RECURRENCE_CATCHUP = 60;

/** Upper bound of future occurrences generated ahead of the current date. */
export const BILLING_RECURRENCE_LOOKAHEAD_DAYS = 0;
