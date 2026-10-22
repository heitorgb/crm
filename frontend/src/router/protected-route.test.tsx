// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSession } from '@/types/auth';
import { ProtectedRoute } from './protected-route';

const session: AuthSession = {
  accessToken: 'token',
  tokenType: 'Bearer',
  expiresIn: 900,
  expiresAt: Date.now() + 900_000,
  user: { id: 'user-1', name: 'Ana', email: 'ana@example.com', avatarUrl: null },
  tenant: { id: 'tenant-1', name: 'OrderUp' },
  role: 'OWNER',
  membershipId: 'member-1',
};

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/login" element={<div>tela de login</div>} />
        <Route
          path="/private"
          element={
            <ProtectedRoute>
              <div>conteúdo protegido</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ session: null, status: 'idle', memberships: [], platformAdmin: false });
});

afterEach(() => {
  cleanup();
});

describe('ProtectedRoute', () => {
  it('waits for the session check before redirecting', () => {
    useAuthStore.setState({ status: 'loading' });

    renderRoute();

    expect(screen.getByText('Verificando sua sessão…')).toBeTruthy();
    expect(screen.queryByText('tela de login')).toBeNull();
  });

  it('renders protected content for an authenticated session', () => {
    useAuthStore.setState({ session, status: 'authenticated' });

    renderRoute();

    expect(screen.getByText('conteúdo protegido')).toBeTruthy();
  });

  it('redirects to login only when the session is confirmed invalid', () => {
    useAuthStore.setState({ status: 'unauthenticated' });

    renderRoute();

    expect(screen.getByText('tela de login')).toBeTruthy();
  });

  it('offers a retry instead of redirecting when the session check fails temporarily', () => {
    useAuthStore.setState({ status: 'unavailable' });

    renderRoute();

    expect(screen.queryByText('tela de login')).toBeNull();
    expect(screen.getByText(/Não foi possível verificar sua sessão/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(useAuthStore.getState().status).toBe('idle');
  });
});
