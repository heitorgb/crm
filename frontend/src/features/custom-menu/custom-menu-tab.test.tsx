// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('./queries', () => ({
  useCustomMenu: () => ({
    data: [
      {
        id: 'existing-group',
        name: 'Lojas',
        icon: 'store',
        active: true,
        position: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        buttons: [
          {
            id: 'existing-button',
            name: 'Loja existente',
            url: 'https://loja.example.com',
            icon: 'external-link',
            active: true,
            position: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ],
    isPending: false,
    isError: false,
    refetch: mocks.refetch,
  }),
  useSaveCustomMenu: () => ({
    mutateAsync: mocks.save,
    isPending: false,
  }),
}));

import { CustomMenuTab } from './custom-menu-tab';

afterEach(() => {
  cleanup();
  mocks.save.mockReset();
  mocks.refetch.mockReset();
});

describe('CustomMenuTab', () => {
  it('persists a new group without dropping the groups already loaded', async () => {
    mocks.save.mockResolvedValue({ groups: [] });

    render(<CustomMenuTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: 'Novo grupo' }));
    fireEvent.change(screen.getByLabelText(/Nome do menu/), {
      target: { value: 'DF5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar botão' }));
    fireEvent.change(screen.getByLabelText(/Nome do botão/), {
      target: { value: 'Sistema DF5' },
    });
    fireEvent.change(screen.getByLabelText(/^URL/), {
      target: { value: 'https://df5.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar grupo' }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

    const payload = mocks.save.mock.calls[0][0] as {
      groups: Array<{ id?: string; name: string; buttons: Array<{ name: string }> }>;
    };

    expect(payload.groups).toHaveLength(2);
    expect(payload.groups[0]).toMatchObject({
      id: 'existing-group',
      name: 'Lojas',
      buttons: [expect.objectContaining({ name: 'Loja existente' })],
    });
    expect(payload.groups[1]).toMatchObject({
      name: 'DF5',
      buttons: [expect.objectContaining({ name: 'Sistema DF5' })],
    });
  });
});
