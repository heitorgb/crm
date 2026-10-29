// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  WhatsAppHistorySync,
  WhatsAppHistorySyncStatus,
  WhatsAppInstance,
} from '@/types/whatsapp';
import { HistorySyncBanner } from './history-sync-banner';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function sync(
  status: WhatsAppHistorySyncStatus,
  overrides: Partial<WhatsAppHistorySync> = {},
): WhatsAppHistorySync {
  return {
    status,
    progress: status === 'SYNCING' ? 42 : status === 'COMPLETED' ? 100 : null,
    chunks: status === 'SYNCING' ? 3 : null,
    messages: status === 'COMPLETED' ? 128 : null,
    startedAt: new Date().toISOString(),
    completedAt: status === 'COMPLETED' ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

function instance(id: string, name: string, historySync: WhatsAppHistorySync): WhatsAppInstance {
  return {
    id,
    name,
    instanceName: name.toLowerCase(),
    externalInstanceId: null,
    phone: null,
    status: 'CONNECTED',
    statusReason: null,
    connectionObservedAt: null,
    active: true,
    hasCredentials: false,
    historySync,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderBanner(instances: WhatsAppInstance[], selectedInstanceId = 'ALL') {
  return render(
    <HistorySyncBanner instances={instances} selectedInstanceId={selectedInstanceId} />,
  );
}

describe('HistorySyncBanner', () => {
  it('shows the instance name and the real provider percentage', () => {
    renderBanner([instance('1', 'Caio', sync('SYNCING', { progress: 42 }))]);

    expect(screen.getByText('Sincronizando histórico do WhatsApp — Caio')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText(/3 lotes recebidos/)).toBeTruthy();
  });

  it('uses an indeterminate bar when the provider did not report a percentage', () => {
    renderBanner([
      instance(
        '1',
        'Caio',
        sync('SYNCING', {
          progress: null,
          chunks: null,
          startedAt: null,
          updatedAt: null,
        }),
      ),
    ]);

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText('Aguardando informações de progresso do WhatsApp.')).toBeTruthy();
  });

  it('does not invent a percentage when several instances are syncing', () => {
    renderBanner([
      instance('1', 'Caio', sync('SYNCING', { progress: 20 })),
      instance('2', 'Atendimento', sync('SYNCING', { progress: 80 })),
    ]);

    expect(screen.getByText('Sincronizando histórico do WhatsApp — 2 instâncias')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('20%')).toBeNull();
    expect(screen.queryByText('80%')).toBeNull();
  });

  it('shows a discreet confirmation and removes it after a while', () => {
    vi.useFakeTimers();

    renderBanner([instance('1', 'Caio', sync('COMPLETED'))]);

    expect(screen.getByText('Histórico do WhatsApp sincronizado — Caio')).toBeTruthy();
    expect(screen.getByText(/128 mensagens processadas/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.queryByText('Histórico do WhatsApp sincronizado — Caio')).toBeNull();
  });

  it('explains a confirmed failure without exposing internal details', () => {
    renderBanner([
      instance('1', 'Caio', sync('FAILED', { progress: 30, error: 'history_import_failed' })),
    ]);

    expect(
      screen.getByText('Não foi possível confirmar a sincronização do histórico'),
    ).toBeTruthy();
    expect(screen.getByText(/As mensagens novas continuam sendo recebidas/)).toBeTruthy();
    expect(screen.queryByText('history_import_failed')).toBeNull();
  });

  it('shows a long silence as unknown instead of active or completed', () => {
    renderBanner([
      instance(
        '1',
        'Caio',
        sync('SYNCING', {
          progress: 65,
          updatedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
        }),
      ),
    ]);

    expect(screen.getByText('Sincronização do histórico sem atualizações recentes')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('65%')).toBeNull();
    expect(screen.queryByText('Histórico do WhatsApp sincronizado — Caio')).toBeNull();
  });

  it('filters by the selected instance', () => {
    renderBanner(
      [
        instance('1', 'Caio', sync('SYNCING', { progress: 10 })),
        instance('2', 'Atendimento', sync('SYNCING', { progress: 90 })),
      ],
      '2',
    );

    expect(screen.getByText('Sincronizando histórico do WhatsApp — Atendimento')).toBeTruthy();
    expect(screen.getByText('90%')).toBeTruthy();
    expect(screen.queryByText('Caio')).toBeNull();
  });

  it('can be dismissed without blocking the attendance screen', () => {
    renderBanner([instance('1', 'Caio', sync('SYNCING'))]);

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar aviso de sincronização' }));

    expect(screen.queryByText('Sincronizando histórico do WhatsApp — Caio')).toBeNull();
  });
});
