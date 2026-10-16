// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BillingCharge, BillingOverview, BillingSettings } from '@/types/billing';

const state = vi.hoisted(() => ({
  overview: null as unknown,
  charges: [] as unknown,
  pending: false,
  error: false,
}));

vi.mock('./queries', () => ({
  billingKeys: { all: ['billing'] },
  useBillingOverview: () => ({
    data: state.overview as BillingOverview | null,
    isPending: state.pending,
    isError: state.error,
  }),
  useBillingCharges: () => ({
    data: { data: state.charges, meta: { page: 1, perPage: 20, total: 0, totalPages: 0 } },
    isPending: state.pending,
    isError: state.error,
    refetch: vi.fn(),
  }),
  usePayCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChargeReminders: () => ({ data: { data: [] }, isPending: false, isError: false }),
  useBillingRecurrences: () => ({ data: { data: [] }, isPending: false, isError: false }),
  useDeactivateRecurrence: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBillingSettings: () => ({
    data: {
      remindersEnabled: true,
      reminderOffsets: [-3, 0, 3],
      messageTemplate: 'Oi {cliente}',
      whatsappInstanceId: null,
      sendWindowStartHour: 9,
      sendWindowEndHour: 18,
    } as BillingSettings,
    isPending: false,
    isError: false,
    dataUpdatedAt: 0,
  }),
  useUpdateBillingSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/customers/queries', () => ({
  useCustomers: () => ({ data: { data: [] } }),
  useCustomer: () => ({ data: undefined }),
}));

vi.mock('@/features/whatsapp/queries', () => ({
  useWhatsAppInstances: () => ({ data: { data: [] } }),
}));

import { BillingPage } from './billing-page';

const charge: BillingCharge = {
  id: 'charge-1',
  customerId: 'customer-1',
  customerName: 'Acme',
  contactId: null,
  contactName: null,
  contactPhone: null,
  recurrenceId: null,
  description: 'Mensalidade',
  amountCents: 15075,
  dueDate: '2026-10-16',
  status: 'OVERDUE',
  paidAt: null,
  paidByUserId: null,
  canceledAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('BillingPage', () => {
  it('renders the indicators and the charge list', () => {
    state.pending = false;
    state.error = false;
    state.charges = [charge];
    state.overview = {
      period: { from: '2026-10-01', to: '2026-10-16' },
      totalPendingCents: 1000,
      totalOverdueCents: 15075,
      totalPaidCents: 5000,
      pendingCount: 1,
      overdueCount: 1,
      paidCount: 1,
      failedReminders: 2,
      upcoming: [],
    } satisfies BillingOverview;

    render(<BillingPage />);

    expect(screen.getByText('Cobranças')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Vencida')).toBeTruthy();
    expect(screen.getByText('Mensalidade')).toBeTruthy();
    expect(screen.getAllByText('R$ 150,75').length).toBeGreaterThan(0);
    expect(screen.getByText('R$ 50,00')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows the empty state when there are no charges', () => {
    state.pending = false;
    state.error = false;
    state.charges = [];
    state.overview = {
      period: { from: '2026-10-01', to: '2026-10-16' },
      totalPendingCents: 0,
      totalOverdueCents: 0,
      totalPaidCents: 0,
      pendingCount: 0,
      overdueCount: 0,
      paidCount: 0,
      failedReminders: 0,
      upcoming: [],
    } satisfies BillingOverview;

    render(<BillingPage />);

    expect(screen.getByText('Nenhuma cobrança encontrada')).toBeTruthy();
  });
});
