import { describe, expect, it } from 'vitest';
import type { WhatsAppHistorySync } from '@/types/whatsapp';
import { formatHistorySyncUpdatedAt, isHistorySyncStale } from './history-sync-utils';

function sync(overrides: Partial<WhatsAppHistorySync> = {}): WhatsAppHistorySync {
  return {
    status: 'SYNCING',
    progress: 42,
    chunks: 3,
    messages: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    updatedAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

describe('isHistorySyncStale', () => {
  it('treats a short pause as normal progress', () => {
    const now = Date.now();
    expect(
      isHistorySyncStale(sync({ updatedAt: new Date(now - 5 * 60_000).toISOString() }), now),
    ).toBe(false);
  });

  it('marks a long silence as unknown without completing the sync', () => {
    const now = Date.now();
    expect(
      isHistorySyncStale(sync({ updatedAt: new Date(now - 11 * 60_000).toISOString() }), now),
    ).toBe(true);
  });

  it('never marks completed or idle states as stale', () => {
    const now = Date.now();
    const old = new Date(now - 60 * 60_000).toISOString();
    expect(isHistorySyncStale(sync({ status: 'COMPLETED', updatedAt: old }), now)).toBe(false);
    expect(isHistorySyncStale(sync({ status: 'IDLE', updatedAt: old }), now)).toBe(false);
  });
});

describe('formatHistorySyncUpdatedAt', () => {
  const now = Date.now();

  it('formats recent updates in Portuguese', () => {
    expect(formatHistorySyncUpdatedAt(new Date(now - 20_000).toISOString(), now)).toBe(
      'agora há pouco',
    );
    expect(formatHistorySyncUpdatedAt(new Date(now - 60_000).toISOString(), now)).toBe(
      'há 1 minuto',
    );
    expect(formatHistorySyncUpdatedAt(new Date(now - 5 * 60_000).toISOString(), now)).toBe(
      'há 5 minutos',
    );
    expect(formatHistorySyncUpdatedAt(new Date(now - 2 * 60 * 60_000).toISOString(), now)).toBe(
      'há 2 horas',
    );
  });

  it('returns null when there is no usable timestamp', () => {
    expect(formatHistorySyncUpdatedAt(null, now)).toBeNull();
    expect(formatHistorySyncUpdatedAt('not-a-date', now)).toBeNull();
  });
});
