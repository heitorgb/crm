// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './login-page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('LoginPage', () => {
  it('exposes browser password manager autocomplete hints', () => {
    renderPage();

    expect(screen.getByLabelText('E-mail').getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Senha').getAttribute('autocomplete')).toBe(
      'current-password',
    );
    expect(document.querySelector('form')?.getAttribute('name')).toBe('login');
  });

  it('toggles the remember password option and persists only the preference', () => {
    renderPage();

    const checkbox = screen.getByRole('checkbox', { name: 'Lembrar senha' }) as HTMLInputElement;

    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(localStorage.getItem('orderup.remember-password')).toBe('true');
    expect(localStorage.getItem('orderup-auth')).toBeNull();
  });

  it('restores the remember password preference after a reload', () => {
    localStorage.setItem('orderup.remember-password', 'true');

    renderPage();

    expect(
      (screen.getByRole('checkbox', { name: 'Lembrar senha' }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
