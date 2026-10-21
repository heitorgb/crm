// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { authService } from './services/auth-service';
import { ResetPasswordPage } from './reset-password-page';

vi.mock('./services/auth-service', () => ({
  authService: {
    resetPassword: vi.fn(),
  },
}));

const TOKEN = 'a'.repeat(43);

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderPage(entry = `/redefinir-senha?token=${TOKEN}`) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <ResetPasswordPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(authService.resetPassword).mockReset();
  vi.mocked(authService.resetPassword).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('ResetPasswordPage', () => {
  it('shows an invalid-link state when the token is missing', () => {
    renderPage('/redefinir-senha');

    expect(screen.getByText('Link inválido')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Solicitar novo link/ })).toBeTruthy();
  });

  it('blocks divergent passwords on the client without calling the API', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senha-12345' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), {
      target: { value: 'senha-54321' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Redefinir senha/ }));

    expect(screen.getByRole('alert').textContent).toContain('As senhas não conferem.');
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('enforces the existing minimum password length', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /Redefinir senha/ }));

    expect(screen.getByRole('alert').textContent).toContain('pelo menos 8 caracteres');
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('resets the password, clears the token from the URL and points back to login', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senha-12345' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), {
      target: { value: 'senha-12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Redefinir senha/ }));

    expect(await screen.findByText('Senha redefinida')).toBeTruthy();
    expect(authService.resetPassword).toHaveBeenCalledWith({
      token: TOKEN,
      newPassword: 'senha-12345',
    });
    expect(screen.getByRole('link', { name: /Ir para o login/ })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/redefinir-senha');
    });
  });
});
