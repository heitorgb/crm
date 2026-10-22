import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSession, AuthSessionResponse } from '@/types/auth';
import {
  REFRESH_SKEW_MS,
  getValidAccessToken,
  refreshSession,
  sessionExpiresSoon,
  toSession,
} from './session-refresh';

const session: AuthSession = {
  accessToken: 'old-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  expiresAt: Date.now() + 900_000,
  user: { id: 'user-1', name: 'Ana', email: 'ana@example.com', avatarUrl: null },
  tenant: { id: 'tenant-1', name: 'OrderUp' },
  role: 'OWNER',
  membershipId: 'member-1',
};

const refreshedPayload: AuthSessionResponse = {
  accessToken: 'new-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: session.user,
  tenant: session.tenant,
  role: session.role,
  membershipId: session.membershipId,
};

beforeEach(() => {
  useAuthStore.setState({
    session,
    status: 'authenticated',
    memberships: [],
    platformAdmin: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ session: null, status: 'idle', memberships: [], platformAdmin: false });
});

describe('session refresh', () => {
  it('restores the session from the refresh cookie and marks it authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(refreshedPayload), { status: 200 })),
    );

    await expect(refreshSession()).resolves.toBe('refreshed');

    expect(useAuthStore.getState().session?.accessToken).toBe('new-token');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('clears the session when the server confirms the refresh token is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(refreshSession()).resolves.toBe('unauthenticated');

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('clears the session when the refresh endpoint rejects with 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(refreshSession()).resolves.toBe('unauthenticated');

    expect(useAuthStore.getState().session).toBeNull();
  });

  it('keeps the session when the network is temporarily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(refreshSession()).resolves.toBe('unavailable');

    expect(useAuthStore.getState().session).toEqual(session);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('keeps the session when the server is temporarily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(refreshSession()).resolves.toBe('unavailable');

    expect(useAuthStore.getState().session).toEqual(session);
  });

  it('shares a single refresh request across concurrent callers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(refreshedPayload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([refreshSession(), refreshSession(), getValidAccessToken()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('session timing helpers', () => {
  it('computes the local expiry from expiresIn', () => {
    expect(toSession(refreshedPayload, 1_000).expiresAt).toBe(901_000);
  });

  it('treats a missing or nearly expired token as due for refresh', () => {
    expect(sessionExpiresSoon(undefined)).toBe(true);
    expect(sessionExpiresSoon(Date.now() + REFRESH_SKEW_MS - 1)).toBe(true);
    expect(sessionExpiresSoon(Date.now() + REFRESH_SKEW_MS + 60_000)).toBe(false);
  });
});
