// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { authService } from './services/auth-service';
import { ForgotPasswordPage } from './forgot-password-page';

vi.mock('./services/auth-service', () => ({
  authService: {
    forgotPassword: vi.fn(),
  },
}));

const GENERIC_MESSAGE =
  'Se existir uma conta associada a esse e-mail, você receberá as instruções para redefinir sua senha.';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/esqueci-senha']}>
        <ForgotPasswordPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(authService.forgotPassword).mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ForgotPasswordPage', () => {
  it('validates the e-mail before calling the API', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'invalido' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar link de recuperação/ }));

    expect(screen.getByRole('alert').textContent).toContain('Informe um e-mail válido.');
    expect(authService.forgotPassword).not.toHaveBeenCalled();
  });

  it('shows the generic confirmation and never reveals whether the account exists', async () => {
    vi.mocked(authService.forgotPassword).mockResolvedValue({ message: GENERIC_MESSAGE });
    renderPage();

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enviar link de recuperação/ }));

    expect(await screen.findByText(GENERIC_MESSAGE)).toBeTruthy();
    expect(authService.forgotPassword).toHaveBeenCalledWith({ email: 'ana@example.com' });
    expect(screen.queryByRole('button', { name: /Enviar link de recuperação/ })).toBeNull();
  });

  it('shows a safe error when the request fails', async () => {
    vi.mocked(authService.forgotPassword).mockRejectedValue(new Error('network'));
    renderPage();

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enviar link de recuperação/ }));

    expect(
      await screen.findByText('Não foi possível processar sua solicitação. Tente novamente.'),
    ).toBeTruthy();
    expect(screen.queryByText(GENERIC_MESSAGE)).toBeNull();
  });
});
