// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Contact } from '@/types/crm';
import { useContact, useContacts, useDeleteContact } from './queries';

vi.mock('./queries', () => ({
  useContacts: vi.fn(),
  useContact: vi.fn(),
  useDeleteContact: vi.fn(),
  useCreateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/attendance/start-conversation-dialog', () => ({
  StartConversationDialog: () => null,
}));

import { ContactListPage } from './contact-list-page';

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
  customerId: null,
  customerName: null,
  name: 'Ana Souza',
  email: 'ana@example.com',
  phone: '5511999999999',
  birthDate: '1990-02-28',
  address: 'Rua das Flores, 123',
  position: 'Diretora',
  avatarUrl: null,
  isPrimary: false,
  isBlocked: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useContacts).mockReturnValue({
    data: {
      data: [contact],
      meta: { page: 1, perPage: 20, total: 1, totalPages: 1 },
      summary: { total: 12, primary: 3, blocked: 2, incomplete: 5 },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useContact).mockReturnValue({
    data: contact,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useDeleteContact).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as never);
});

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <ContactListPage />
    </MemoryRouter>,
  );
}

function openContactActions(): void {
  const trigger = screen.getByRole('button', { name: 'Mais ações para Ana Souza' });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe('ContactListPage details panel', () => {
  it('opens the contact details when the row is clicked', () => {
    renderPage();

    fireEvent.click(screen.getByText('Ana Souza'));

    expect(screen.getByText('Informações pessoais')).toBeTruthy();
    expect(screen.getByText('Rua das Flores, 123')).toBeTruthy();
  });

  it('opens the contact details from the keyboard', () => {
    renderPage();

    const row = screen.getByText('Ana Souza').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.keyDown(row as HTMLTableRowElement, { key: 'Enter' });

    expect(screen.getByText('Informações pessoais')).toBeTruthy();
  });

  it('does not open the details panel when an action is used', () => {
    renderPage();

    openContactActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar contato' }));

    expect(screen.queryByText('Informações pessoais')).toBeNull();
    expect(screen.getByText('Editar contato')).toBeTruthy();
  });

  it('shows real summary counts in the quick filters', () => {
    renderPage();

    expect(screen.getByRole('button', { name: /Todos/ }).textContent).toContain('12');
    expect(screen.getByRole('button', { name: /Principais/ }).textContent).toContain('3');
    expect(screen.getByRole('button', { name: /Bloqueados/ }).textContent).toContain('2');
    expect(screen.getByRole('button', { name: /Dados incompletos/ }).textContent).toContain('5');
  });

  it('applies the quick filters through the contacts query', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Bloqueados/ }));

    expect(screen.getByRole('button', { name: /Bloqueados/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(vi.mocked(useContacts)).toHaveBeenLastCalledWith(
      expect.objectContaining({ filter: 'blocked', page: 1, includeSummary: true }),
    );
  });

  it('applies an advanced filter through the compact menu', () => {
    renderPage();

    const trigger = screen.getByRole('button', { name: 'Filtros' });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Com telefone' }));

    expect(vi.mocked(useContacts)).toHaveBeenLastCalledWith(
      expect.objectContaining({ extraFilter: 'with_phone', page: 1 }),
    );
    expect(screen.getByRole('button', { name: 'Com telefone' })).toBeTruthy();
  });

  it('changes the ordering through the compact menu', () => {
    renderPage();

    const trigger = screen.getByRole('button', { name: /Ordenar:/ });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nome (A-Z)' }));

    expect(vi.mocked(useContacts)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'name', order: 'asc', page: 1 }),
    );
  });

  it('asks for confirmation before deleting a contact', () => {
    renderPage();

    openContactActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir contato' }));

    expect(screen.getByText('O contato "Ana Souza" será removido.')).toBeTruthy();
    expect(screen.queryByText('Informações pessoais')).toBeNull();
  });

  it('opens the existing edit form from the details panel', () => {
    renderPage();

    fireEvent.click(screen.getByText('Ana Souza'));
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(screen.queryByText('Informações pessoais')).toBeNull();
    expect(screen.getByText('Editar contato')).toBeTruthy();
  });

  it('keeps the listing context after closing the details panel', () => {
    renderPage();

    fireEvent.click(screen.getByText('Ana Souza'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));

    expect(screen.queryByText('Informações pessoais')).toBeNull();
    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
  });
});
