// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WhatsAppQuota } from '@/types/whatsapp';

afterEach(cleanup);

const state = vi.hoisted(() => ({
  quota: { used: 1, canCreate: false } as WhatsAppQuota,
  refetch: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock('@/providers/use-realtime', () => ({
  useRealtime: () => ({ socket: null }),
}));

vi.mock('@/features/whatsapp/queries', () => ({
  whatsappKeys: { all: ['whatsapp-instances'] },
  useWhatsAppInstances: () => ({
    data: {
      data: [
        {
          id: 'instance-1',
          name: 'Atendimento',
          instanceName: 'atendimento',
          externalInstanceId: null,
          phone: null,
          status: 'CONNECTED',
          active: true,
          hasCredentials: false,
          historySync: {
            status: 'SYNCING',
            progress: 42,
            startedAt: new Date().toISOString(),
            completedAt: null,
            error: null,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useWhatsAppQuota: () => ({
    data: state.quota,
    refetch: state.refetch,
  }),
  useWhatsAppInstanceStatus: () => ({ data: null }),
  useCreateWhatsAppInstance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWhatsAppInstance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConnectWhatsAppInstance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisconnectWhatsAppInstance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfigureWhatsAppWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWhatsAppInstance: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { WhatsAppTab } from './whatsapp-tab';

function renderTab() {
  return render(
    <MemoryRouter>
      <WhatsAppTab />
    </MemoryRouter>,
  );
}

describe('WhatsAppTab instance limit', () => {
  it('shows a friendly message when opening a new instance at the limit', async () => {
    state.quota = { used: 1, canCreate: false };
    state.refetch.mockResolvedValue({ data: state.quota });

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /nova instância/i }));

    expect(await screen.findByText('Não é possível adicionar outra instância')).toBeTruthy();
    expect(
      screen.getByText(/já possui uma instância WhatsApp cadastrada/i),
    ).toBeTruthy();
    expect(screen.queryByText(/limite/i)).toBeNull();
    expect(screen.queryByText(/administrador da plataforma/i)).toBeNull();
  });

  it('shows the real synchronization progress instead of claiming completion', () => {
    renderTab();

    expect(screen.getAllByText('Sincronizando histórico: 42%').length).toBeGreaterThan(0);
    expect(screen.queryByText('Histórico sincronizado')).toBeNull();
  });

  it('opens the form when there is an available slot', async () => {
    state.quota = { used: 1, canCreate: true };
    state.refetch.mockResolvedValue({ data: state.quota });

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /nova instância/i }));

    expect(await screen.findByText('Nova instância WhatsApp')).toBeTruthy();
    expect(screen.queryByText('Não é possível adicionar outra instância')).toBeNull();
  });
});
