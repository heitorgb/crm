// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  createContact: vi.fn(),
  updateContact: vi.fn(),
}));

vi.mock('./queries', () => ({
  useCreateContact: () => ({ mutateAsync: mocks.createContact, isPending: false }),
  useUpdateContact: () => ({ mutateAsync: mocks.updateContact, isPending: false }),
}));

import { ContactForm } from './contact-form';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createContact.mockResolvedValue({});
  mocks.updateContact.mockResolvedValue({});
});

afterEach(cleanup);

const existingContact = {
  id: 'contact-1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  phone: '5511999999999',
  birthDate: '1990-02-28',
  address: 'Rua das Flores, 123',
  position: 'Diretora',
  isPrimary: false,
  isBlocked: false,
  customerId: null,
};

describe('ContactForm profile fields', () => {
  it('loads the birth date and address of an existing contact', () => {
    render(<ContactForm open onOpenChange={() => {}} contact={existingContact} />);

    expect(screen.getByLabelText('Data de nascimento')).toHaveProperty('value', '1990-02-28');
    expect(screen.getByLabelText('Endereço')).toHaveProperty('value', 'Rua das Flores, 123');
  });

  it('saves edited birth date and address', async () => {
    render(<ContactForm open onOpenChange={() => {}} contact={existingContact} />);

    fireEvent.change(screen.getByLabelText('Data de nascimento'), {
      target: { value: '1991-03-15' },
    });
    fireEvent.change(screen.getByLabelText('Endereço'), {
      target: { value: 'Avenida Brasil, 10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(mocks.updateContact).toHaveBeenCalledWith({
        id: 'contact-1',
        input: expect.objectContaining({
          birthDate: '1991-03-15',
          address: 'Avenida Brasil, 10',
        }),
      }),
    );
  });

  it('creates a contact leaving the optional fields empty', async () => {
    render(<ContactForm open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Bruno Lima' } });
    fireEvent.change(screen.getByLabelText(/Telefone/), { target: { value: '5511888888888' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(mocks.createContact).toHaveBeenCalledWith(
        expect.objectContaining({ birthDate: null, address: null }),
      ),
    );
  });
});
