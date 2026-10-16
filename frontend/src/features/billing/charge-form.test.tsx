// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  contacts: [] as unknown,
  contactsPending: false,
  contactsError: false,
}));

vi.mock('./queries', () => ({
  useCreateCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/contacts/queries', () => ({
  useContacts: () => ({
    data: { data: state.contacts },
    isPending: state.contactsPending,
    isError: state.contactsError,
  }),
}));

import { ChargeForm } from './charge-form';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

function openSelect(): void {
  const trigger = screen.getByRole('combobox');
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe('ChargeForm clients', () => {
  it('lists available clients from the contacts endpoint', () => {
    state.contacts = [
      { id: 'c1', name: 'Ana Souza', phone: '5511999999999' },
      { id: 'c2', name: 'Bruno Lima', phone: null },
    ];
    state.contactsPending = false;
    state.contactsError = false;

    render(<ChargeForm open onOpenChange={() => {}} />);
    openSelect();

    expect(screen.getByText('Ana Souza — 5511999999999')).toBeTruthy();
    expect(screen.getByText('Bruno Lima')).toBeTruthy();
  });

  it('handles an empty client list', () => {
    state.contacts = [];
    state.contactsPending = false;
    state.contactsError = false;

    render(<ChargeForm open onOpenChange={() => {}} />);
    openSelect();

    expect(screen.getByText('Nenhum cliente cadastrado')).toBeTruthy();
  });

  it('shows a clear message when the API fails', () => {
    state.contacts = [];
    state.contactsPending = false;
    state.contactsError = true;

    render(<ChargeForm open onOpenChange={() => {}} />);

    expect(
      screen.getByText('Não foi possível carregar os clientes. Verifique sua conexão e tente novamente.'),
    ).toBeTruthy();
  });

  it('requires selecting a client before saving', () => {
    state.contacts = [];
    state.contactsPending = false;
    state.contactsError = false;

    render(<ChargeForm open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(screen.getByText('Selecione um cliente.')).toBeTruthy();
  });
});
