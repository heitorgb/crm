// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: mocks.request,
}));
vi.mock('@/components/common/user-avatar', () => ({ UserAvatar: () => null }));
vi.mock('./member-form', () => ({ MemberForm: () => null }));

import { TeamTab } from './team-tab';

const members = [
  { id: 'member-admin', userId: 'u-1', name: 'Dona', email: 'dona@x.com', avatarUrl: null, role: 'OWNER', active: true, storeIds: [] },
  { id: 'member-clerk', userId: 'u-2', name: 'Caio', email: 'caio@x.com', avatarUrl: null, role: 'USER', active: true, storeIds: [] },
];
const stores = [{ id: 'store-1', name: 'JP Peças' }, { id: 'store-2', name: 'Loja Centro' }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderTab() {
  mocks.request.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    if (path === '/members') return Promise.resolve(members);
    if (path === '/store-orders/stores/manage') return Promise.resolve(stores);
    if (path === '/members/member-clerk' && options?.method === 'PATCH') {
      return Promise.resolve({ ...members[1], ...(options.body as object) });
    }
    return Promise.reject(new Error(`Rota inesperada: ${path}`));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><TeamTab canManage /></QueryClientProvider>);
}

describe('TeamTab store access', () => {
  it('links a user to the selected stores', async () => {
    renderTab();

    const [storesButton] = await screen.findAllByRole('button', { name: 'Lojas de Caio' });
    expect(screen.queryAllByRole('button', { name: 'Lojas de Dona' })).toHaveLength(0);
    fireEvent.click(storesButton);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Loja Centro'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/members/member-clerk', {
      method: 'PATCH', body: { storeIds: ['store-2'] },
    }));
  });

  it('hides the store column when the organization has no stores', async () => {
    mocks.request.mockImplementation((path: string) =>
      path === '/members' ? Promise.resolve(members) : Promise.reject(new Error('Módulo desativado')));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><TeamTab canManage /></QueryClientProvider>);

    expect((await screen.findAllByText('Caio')).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: 'Lojas de Caio' })).toHaveLength(0);
  });
});
