// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSession } from '@/types/auth';

const { refreshSession } = vi.hoisted(() => ({ refreshSession: vi.fn() }));

vi.mock('@/lib/session-refresh', () => ({ refreshSession }));

import { SessionBootstrap } from './session-bootstrap';

const session: AuthSession = {
  accessToken: 'restored-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  expiresAt: Date.now() + 900_000,
  user: { id: 'user-1', name: 'Ana', email: 'ana@example.com', avatarUrl: null },
  tenant: { id: 'tenant-1', name: 'OrderUp' },
  role: 'OWNER',
  membershipId: 'member-1',
};

beforeEach(() => {
  refreshSession.mockReset();
  useAuthStore.setState({ session: null, status: 'idle', memberships: [], platformAdmin: false });
});

afterEach(() => {
  cleanup();
});

describe('SessionBootstrap', () => {
  it('restores a persisted session when the application starts', async () => {
    refreshSession.mockImplementation(async () => {
      useAuthStore.getState().setSession(session);
      return 'refreshed';
    });

    render(
      <SessionBootstrap>
        <div>app</div>
      </SessionBootstrap>,
    );

    expect(screen.getByText('app')).toBeTruthy();
    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(useAuthStore.getState().session?.accessToken).toBe('restored-token');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('marks the session as unauthenticated when the refresh cookie is invalid', async () => {
    refreshSession.mockImplementation(async () => {
      useAuthStore.getState().clearSession();
      return 'unauthenticated';
    });

    render(
      <SessionBootstrap>
        <div>app</div>
      </SessionBootstrap>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));
  });

  it('does not discard the session on a temporary failure', async () => {
    useAuthStore.setState({ session, status: 'idle' });
    refreshSession.mockResolvedValue('unavailable');

    render(
      <SessionBootstrap>
        <div>app</div>
      </SessionBootstrap>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('unavailable'));
    expect(useAuthStore.getState().session).toEqual(session);
  });
});
