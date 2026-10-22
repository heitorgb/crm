import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSession } from '@/types/auth';
import { ApiError, apiRequest } from './api-client';

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

describe('api client session handling', () => {
  it('surfaces a 403 as a permission error without logging the user out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Sem permissão' }), {
          status: 403,
        }),
      ),
    );

    await expect(apiRequest('/private')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(useAuthStore.getState().session).toEqual(session);
  });

  it('does not log the user out when refresh fails due to a temporary network error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'INVALID_ACCESS_TOKEN', message: 'expirado' }), {
          status: 401,
        }),
      )
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/private')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().session).toEqual(session);
  });
});
