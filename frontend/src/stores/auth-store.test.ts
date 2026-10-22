// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthSession } from '@/types/auth';
import { useAuthStore } from './auth-store';

const session: AuthSession = {
  accessToken: 'jwt-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  expiresAt: Date.now() + 900_000,
  user: { id: 'user-1', name: 'Ana', email: 'ana@example.com', avatarUrl: null },
  tenant: { id: 'tenant-1', name: 'OrderUp' },
  role: 'OWNER',
  membershipId: 'member-1',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.setState({ session: null, status: 'idle', memberships: [], platformAdmin: false });
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('auth store', () => {
  it('keeps the access token only in memory', () => {
    useAuthStore.getState().setSession(session);

    expect(useAuthStore.getState().session).toEqual(session);
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(localStorage.getItem('orderup-auth')).toBeNull();
    expect(sessionStorage.getItem('orderup-auth')).toBeNull();
  });

  it('marks the session unauthenticated when cleared', () => {
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().clearSession();

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
