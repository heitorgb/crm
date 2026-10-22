// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import type { Contact } from '@/types/crm';
import { useContact } from './queries';

vi.mock('./queries', () => ({ useContact: vi.fn() }));

import { ContactDetailSheet } from './contact-detail-sheet';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
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

const contact: Contact = {
  id: 'contact-1',
  customerId: 'customer-1',
  customerName: 'OrderUp Demo',
  name: 'Ana Souza',
  email: null,
  phone: '5511999999999',
  birthDate: '1990-02-28',
  address: null,
  position: null,
  avatarUrl: null,
  isPrimary: true,
  isBlocked: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function mockQuery(overrides: Record<string, unknown> = {}): void {
  vi.mocked(useContact).mockReturnValue({
    data: contact,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery();
});

afterEach(cleanup);

describe('ContactDetailSheet', () => {
  it('shows the contact data and a discreet placeholder for empty fields', () => {
    render(
      <ContactDetailSheet
        contactId={contact.id}
        onOpenChange={() => {}}
        onEdit={() => {}}
        onStartConversation={() => {}}
      />,
    );

    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('5511999999999')).toBeTruthy();
    expect(screen.getByText('OrderUp Demo')).toBeTruthy();
    expect(screen.getByText('28/02/1990')).toBeTruthy();
    expect(screen.getByText('Principal')).toBeTruthy();
    expect(screen.getByText('Bloqueado')).toBeTruthy();
    expect(screen.getAllByText('Não informado')).toHaveLength(3);
  });

  it('runs the quick conversation and edit actions with the loaded contact', () => {
    const onEdit = vi.fn();
    const onStartConversation = vi.fn();

    render(
      <ContactDetailSheet
        contactId={contact.id}
        onOpenChange={() => {}}
        onEdit={onEdit}
        onStartConversation={onStartConversation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Conversar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(onStartConversation).toHaveBeenCalledWith(contact);
    expect(onEdit).toHaveBeenCalledWith(contact);
  });

  it('disables the conversation action when the contact has no phone', () => {
    mockQuery({ data: { ...contact, phone: null } });

    render(
      <ContactDetailSheet
        contactId={contact.id}
        onOpenChange={() => {}}
        onEdit={() => {}}
        onStartConversation={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Conversar' })).toHaveProperty('disabled', true);
  });

  it('shows the loading state while fetching the contact', () => {
    mockQuery({ data: undefined, isPending: true });

    render(
      <ContactDetailSheet
        contactId={contact.id}
        onOpenChange={() => {}}
        onEdit={() => {}}
        onStartConversation={() => {}}
      />,
    );

    expect(screen.queryByText('Ana Souza')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('shows a not-found state when the contact no longer exists', () => {
    mockQuery({
      data: undefined,
      isError: true,
      error: new ApiError(404, 'CONTACT_NOT_FOUND', 'Contact not found'),
    });

    render(
      <ContactDetailSheet
        contactId={contact.id}
        onOpenChange={() => {}}
        onEdit={() => {}}
        onStartConversation={() => {}}
      />,
    );

    expect(screen.getByText('Contato não encontrado')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Fechar' }).length).toBeGreaterThan(0);
  });
});
