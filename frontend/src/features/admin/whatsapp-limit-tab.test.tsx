// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

afterEach(cleanup);

const state = vi.hoisted(() => ({
  limit: 3,
  used: 2,
  mutateAsync: vi.fn(async (_limit: number) => undefined),
}));

vi.mock('./queries', () => ({
  useAdminTenant: () => ({
    data: {
      whatsappInstanceLimit: state.limit,
      whatsappInstancesUsed: state.used,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateTenantWhatsAppLimit: () => ({
    mutateAsync: state.mutateAsync,
    isPending: false,
  }),
}));

import { WhatsAppLimitTab } from './whatsapp-limit-tab';

describe('WhatsAppLimitTab', () => {
  it('shows the configured limit and the available slots', () => {
    state.limit = 3;
    state.used = 2;

    render(<WhatsAppLimitTab tenantId="tenant-1" />);

    expect(screen.getByText('2 de 3')).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(screen.queryByText(/acima do limite configurado/i)).toBeNull();
  });

  it('warns when the organization is above the configured limit', () => {
    state.limit = 1;
    state.used = 3;

    render(<WhatsAppLimitTab tenantId="tenant-1" />);

    expect(screen.getByText('3 de 1')).toBeTruthy();
    expect(screen.getByText(/acima do limite configurado/i)).toBeTruthy();
  });

  it('saves the typed limit', async () => {
    state.limit = 3;
    state.used = 2;
    state.mutateAsync.mockClear();

    render(<WhatsAppLimitTab tenantId="tenant-1" />);

    fireEvent.change(screen.getByLabelText('Limite de instâncias WhatsApp'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledWith(8));
    expect(screen.getByText('Limite atualizado com sucesso.')).toBeTruthy();
  });

  it('rejects negative values before calling the API', () => {
    state.limit = 3;
    state.used = 2;
    state.mutateAsync.mockClear();

    render(<WhatsAppLimitTab tenantId="tenant-1" />);

    fireEvent.change(screen.getByLabelText('Limite de instâncias WhatsApp'), {
      target: { value: '-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(
      screen.getByText('O limite deve ser um número inteiro maior ou igual a zero.'),
    ).toBeTruthy();
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });
});
