import type { StatusTone } from '@/components/common/status-badge';
import type {
  BillingChargeStatus,
  BillingReminder,
  BillingReminderStatus,
  BillingSettings,
} from '@/types/billing';

export function formatCurrency(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));
  const reais = Math.floor(absolute / 100);
  const centavos = absolute % 100;
  return `${sign}R$ ${reais.toLocaleString('pt-BR')},${String(centavos).padStart(2, '0')}`;
}

/** Parses a human-typed BRL amount (e.g. "1.234,56" or "150.75") into cents. */
export function parseCurrencyToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const hasComma = trimmed.includes(',');
  const normalized = (hasComma ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed).replace(
    /[^\d.-]/g,
    '',
  );
  if (!/\d/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100);
}

export function centsToInput(cents: number): string {
  const absolute = Math.abs(Math.round(cents));
  const reais = Math.floor(absolute / 100);
  const centavos = absolute % 100;
  return `${reais},${String(centavos).padStart(2, '0')}`;
}

export function serializeOffsets(offsets: number[]): string {
  return [...offsets].sort((a, b) => a - b).join(', ');
}

export function parseOffsets(value: string): number[] | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const parts = trimmed.split(',');
  const result = new Set<number>();
  for (const part of parts) {
    const parsed = Number.parseInt(part.trim(), 10);
    if (!Number.isFinite(parsed) || String(parsed) !== part.trim()) {
      return null;
    }
    result.add(parsed);
  }
  return [...result].sort((a, b) => a - b);
}

const CHARGE_STATUS_LABELS: Record<BillingChargeStatus, string> = {
  PENDING: 'Pendente',
  OVERDUE: 'Vencida',
  PAID: 'Paga',
  CANCELED: 'Cancelada',
};

const CHARGE_STATUS_TONES: Record<BillingChargeStatus, StatusTone> = {
  PENDING: 'info',
  OVERDUE: 'danger',
  PAID: 'success',
  CANCELED: 'secondary',
};

export function chargeStatusLabel(status: BillingChargeStatus): string {
  return CHARGE_STATUS_LABELS[status];
}

export function chargeStatusTone(status: BillingChargeStatus): StatusTone {
  return CHARGE_STATUS_TONES[status];
}

const REMINDER_STATUS_LABELS: Record<BillingReminderStatus, string> = {
  PENDING: 'Pendente',
  PROCESSING: 'Processando',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorado',
};

const REMINDER_STATUS_TONES: Record<BillingReminderStatus, StatusTone> = {
  PENDING: 'info',
  PROCESSING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'secondary',
};

export function reminderStatusLabel(status: BillingReminderStatus): string {
  return REMINDER_STATUS_LABELS[status];
}

export function reminderStatusTone(status: BillingReminderStatus): StatusTone {
  return REMINDER_STATUS_TONES[status];
}

export function offsetLabel(offsetDays: number): string {
  if (offsetDays === 0) return 'No vencimento';
  if (offsetDays < 0) return `${Math.abs(offsetDays)} dia(s) antes`;
  return `${offsetDays} dia(s) depois`;
}

/**
 * Maps an API error to a user-facing message. A legitimate 403 (the user lacks
 * the required membership role) is always presented as a permission error,
 * never as a generic failure.
 */
export function resolveBillingError(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (status === 403) {
      return 'Você não tem permissão para esta operação.';
    }
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

export interface ReminderOutcomeMessage {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  description: string;
}

/**
 * Maps the recorded result of a manual reminder to user-facing feedback. A SENT
 * status only means the provider accepted the request, never that it was
 * delivered.
 */
export function reminderOutcomeMessage(reminder: BillingReminder): ReminderOutcomeMessage {
  switch (reminder.status) {
    case 'SENT':
      return {
        tone: 'success',
        title: 'Envio solicitado',
        description:
          'A Evolution API aceitou o envio do lembrete. A entrega é confirmada pelo WhatsApp.',
      };
    case 'PROCESSING':
    case 'PENDING':
      return {
        tone: 'warning',
        title: 'Processando',
        description: 'O lembrete ainda está sendo processado.',
      };
    case 'SKIPPED':
      return {
        tone: 'warning',
        title: 'Lembrete não enviado',
        description: describeReminderReason(
          reminder.errorMessage,
          'A cobrança não pôde ser enviada.',
        ),
      };
    default:
      return {
        tone: 'danger',
        title: 'Falha ao enviar',
        description: describeReminderReason(
          reminder.errorMessage,
          'Não foi possível enviar o lembrete.',
        ),
      };
  }
}

function describeReminderReason(code: string | null, fallback: string): string {
  switch (code) {
    case 'missing_phone':
      return 'O cliente não possui um telefone válido.';
    case 'no_instance':
      return 'Nenhuma instância de WhatsApp conectada e disponível.';
    case 'evolution_unavailable':
      return 'A integração com o WhatsApp está indisponível.';
    case 'charge_closed':
      return 'A cobrança está paga ou cancelada.';
    default:
      return code?.startsWith('evolution_http_') || code === 'evolution_request_failed'
        ? 'O WhatsApp recusou o envio do lembrete.'
        : fallback;
  }
}

/** Human text for the configured send window, mirroring the backend rule. */
export function describeSendWindow(startHour: number, endHour: number): string {
  if (startHour === endHour) {
    return 'o dia inteiro (início e fim iguais)';
  }
  if (startHour < endHour) {
    return `entre ${startHour}h e ${endHour}h`;
  }
  return `entre ${startHour}h e ${endHour}h, atravessando a meia-noite`;
}

/**
 * Explanation of how automatic reminders actually work, derived from the real
 * scheduler values so the copy never drifts from the backend.
 */
export function reminderScheduleExplanation(
  settings: Pick<
    BillingSettings,
    'scanIntervalMinutes' | 'timeZone' | 'sendWindowStartHour' | 'sendWindowEndHour'
  >,
): string {
  const frequency =
    settings.scanIntervalMinutes > 0
      ? `a cada ${settings.scanIntervalMinutes} minutos`
      : 'em intervalos definidos pelo servidor';
  const window = describeSendWindow(settings.sendWindowStartHour, settings.sendWindowEndHour);
  return (
    `Os dias informados definem quando a cobrança fica elegível para um lembrete. ` +
    `Depois disso, o sistema verifica ${frequency} se há lembretes a enviar e processa as ` +
    `mensagens elegíveis ${window}, no fuso ${settings.timeZone}. ` +
    `O envio não ocorre necessariamente no início da janela, pois as mensagens passam pela ` +
    `fila de processamento. Fora da janela, o lembrete aguarda e é reavaliado na próxima verificação.`
  );
}
