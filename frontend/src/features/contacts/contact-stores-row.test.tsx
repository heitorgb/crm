// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Contact } from '@/types/crm';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiRequest: mocks.request }));

import { ContactStoresRow } from './contact-stores-row';

const contact: Contact = {
  id: 'contact-1', customerId: null, customerName: null, name: 'Ana', email: null, phone: '5511999999999',
  birthDate: null, address: null, position: null, avatarUrl: null, isPrimary: false, isBlocked: false,
  storeIds: ['store-1'], createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z',
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderRow(canManage: boolean) {
  mocks.request.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    if (path === '/store-orders/stores') {
      return Promise.resolve([{ id: 'store-1', name: 'JP Peças' }, { id: 'store-2', name: 'Loja Centro' }]);
    }
    if (path === '/contacts/contact-1/stores' && options?.method === 'PATCH') return Promise.resolve(contact);
    return Promise.reject(new Error(`Rota inesperada: ${path}`));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ContactStoresRow contact={contact} canManage={canManage} /></QueryClientProvider>);
}

describe('ContactStoresRow', () => {
  it('lets admins link the contact to more stores', async () => {
    renderRow(true);

    expect(await screen.findByText('JP Peças')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Vincular lojas' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Loja Centro'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/contacts/contact-1/stores', {
      method: 'PATCH', body: { storeIds: ['store-1', 'store-2'] },
    }));
  });

  it('only shows the linked stores to members', async () => {
    renderRow(false);

    expect(await screen.findByText('JP Peças')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Vincular lojas' })).toBeNull();
  });
});
