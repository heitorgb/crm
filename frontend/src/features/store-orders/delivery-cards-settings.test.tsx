// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  apiRequest: (path: string, options?: { method?: string; body?: unknown }) => {
    if (path !== '/store-orders/cards') throw new Error(`Rota inesperada: ${path}`);
    if (options?.method === 'PATCH') return mocks.update(options.body);
    return Promise.resolve({ statuses: ['PENDENTE_SEPARACAO', 'ENTREGUE'] });
  },
}));

import { DeliveryCardsSettings } from './delivery-cards-settings';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('saves the organization card selection', async () => {
  mocks.update.mockResolvedValue({ statuses: ['PENDENTE_SEPARACAO'] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DeliveryCardsSettings /></QueryClientProvider>);
  const delivered = await screen.findByRole('checkbox', { name: 'Entregues' });
  expect((delivered as HTMLInputElement).checked).toBe(true);
  fireEvent.click(delivered);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ statuses: ['PENDENTE_SEPARACAO'] }));
  await waitFor(() => expect((delivered as HTMLInputElement).checked).toBe(false));
});
