// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BillingCharge, BillingReminder } from '@/types/billing';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries', () => ({
  useSendManualReminder: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

import { SendReminderDialog } from './send-reminder-dialog';

const charge: BillingCharge = {
  id: 'c1',
  customerId: null,
  customerName: null,
  contactId: 'ct1',
  contactName: 'Ana Souza',
  contactPhone: '5511999999999',
  recurrenceId: null,
  description: 'Mensalidade',
  amountCents: 9900,
  dueDate: '2026-10-16',
  status: 'PENDING',
  paidAt: null,
  paidByUserId: null,
  canceledAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function reminder(overrides: Partial<BillingReminder> = {}): BillingReminder {
  return {
    id: 'r1',
    chargeId: 'c1',
    offsetDays: 0,
    origin: 'MANUAL',
    createdByUserId: 'u1',
    scheduledFor: '2026-10-16',
    status: 'SENT',
    attempts: 1,
    destination: '5511999999999',
    whatsappInstanceId: 'i1',
    externalMessageId: 'ext-1',
    errorMessage: null,
    processedAt: '2026-10-16T12:00:00.000Z',
    createdAt: '2026-10-16T12:00:00.000Z',
    ...overrides,
  };
}

describe('SendReminderDialog', () => {
  it('shows the charge and confirms before sending', () => {
    mocks.mutateAsync.mockReset();
    render(<SendReminderDialog open onOpenChange={() => {}} charge={charge} />);

    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('Mensalidade')).toBeTruthy();
    expect(screen.getByText('R$ 99,00')).toBeTruthy();
    expect(screen.getByText(/imediatamente pelo WhatsApp/i)).toBeTruthy();
  });

  it('calls the API and shows the accepted result', async () => {
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockResolvedValue(reminder({ status: 'SENT' }));

    render(<SendReminderDialog open onOpenChange={() => {}} charge={charge} />);
    fireEvent.click(screen.getByRole('button', { name: /Enviar lembrete/i }));

    await waitFor(() => expect(screen.getByText('Envio solicitado')).toBeTruthy());
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      chargeId: 'c1',
      idempotencyKey: expect.any(String),
    });
  });

  it('shows a clear error when the request fails', async () => {
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockRejectedValue(new Error('Cobrança paga ou cancelada'));

    render(<SendReminderDialog open onOpenChange={() => {}} charge={charge} />);
    fireEvent.click(screen.getByRole('button', { name: /Enviar lembrete/i }));

    await waitFor(() => expect(screen.getByText('Cobrança paga ou cancelada')).toBeTruthy());
  });
});
