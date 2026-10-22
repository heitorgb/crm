// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { storePasswordCredential } from '@/lib/password-credentials';
import { useAuthStore } from '@/stores/auth-store';
import { authService } from './services/auth-service';
import { LoginPage } from './login-page';

vi.mock('./services/auth-service', () => ({
  authService: {
    login: vi.fn(),
    me: vi.fn(),
  },
}));

vi.mock('@/lib/password-credentials', () => ({
  storePasswordCredential: vi.fn(),
}));

const session = {
  accessToken: 'access-token',
  tokenType: 'Bearer' as const,
  expiresIn: 900,
  user: { id: 'user-1', name: 'Ana', email: 'ana@example.com', avatarUrl: null },
  tenant: { id: 'tenant-1', name: 'OrderUp' },
  role: 'OWNER' as const,
  membershipId: 'membership-1',
};

const currentSession = {
  user: session.user,
  tenant: session.tenant,
  role: session.role,
  membershipId: session.membershipId,
  memberships: [],
  isPlatformAdmin: false,
};

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

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: ' ana@example.com ' },
  });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-segura' } });
  fireEvent.click(screen.getByRole('button', { name: /^Entrar$/ }));
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ session: null, status: 'idle', memberships: [], platformAdmin: false });
  vi.mocked(authService.login).mockReset();
  vi.mocked(authService.me).mockReset();
  vi.mocked(storePasswordCredential).mockReset();
  vi.mocked(authService.login).mockResolvedValue(session);
  vi.mocked(authService.me).mockResolvedValue(currentSession);
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
    expect(document.querySelector('form')?.getAttribute('action')).toBe('/api/auth/login');
    expect(document.querySelector('form')?.getAttribute('method')).toBe('post');
  });

  it('toggles the remember password option without storing credentials', () => {
    renderPage();

    const checkbox = screen.getByRole('checkbox', { name: 'Lembrar senha' }) as HTMLInputElement;

    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it('starts unchecked on a new visit', () => {
    renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Lembrar senha' }));

    cleanup();
    renderPage();

    expect(
      (screen.getByRole('checkbox', { name: 'Lembrar senha' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('stores credentials in the browser manager after login when checked', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Lembrar senha' }));
    fillAndSubmit();

    await waitFor(() => {
      expect(storePasswordCredential).toHaveBeenCalledWith('ana@example.com', 'senha-segura');
    });
  });

  it('does not request credential storage when unchecked', async () => {
    renderPage();

    fillAndSubmit();

    await waitFor(() => {
      expect(authService.login).toHaveBeenCalledWith({
        email: 'ana@example.com',
        password: 'senha-segura',
      });
      expect(screen.getByRole('button', { name: /^Entrar$/ })).toBeTruthy();
    });

    expect(storePasswordCredential).not.toHaveBeenCalled();
  });
});
