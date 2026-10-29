import type { WhatsAppHistorySync } from '@/types/whatsapp';

/** No progress events for this long means the sync can no longer be shown as active. */
export const HISTORY_SYNC_STALE_MS = 10 * 60 * 1000;

function lastActivityAt(sync: WhatsAppHistorySync): number | null {
  const value = sync.updatedAt ?? sync.startedAt;
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * A stalled progress count is common while WhatsApp processes a large chunk.
 * Only after a long silence do we stop presenting the sync as actively running
 * and show it as unknown. This never marks the sync as completed.
 */
export function isHistorySyncStale(sync: WhatsAppHistorySync, now = Date.now()): boolean {
  if (sync.status !== 'SYNCING') {
    return false;
  }
  const last = lastActivityAt(sync);
  return last !== null && now - last > HISTORY_SYNC_STALE_MS;
}

export function formatHistorySyncUpdatedAt(value: string | null, now = Date.now()): string | null {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return null;
  }

  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) {
    return 'agora há pouco';
  }
  if (minutes === 1) {
    return 'há 1 minuto';
  }
  if (minutes < 60) {
    return `há ${minutes} minutos`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours === 1) {
    return 'há 1 hora';
  }
  if (hours < 24) {
    return `há ${hours} horas`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}
