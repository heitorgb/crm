import { useAuthStore } from '@/stores/auth-store';
import type { AuthSession, AuthSessionResponse } from '@/types/auth';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const API_PREFIX = '/api';

export const REFRESH_SKEW_MS = 30_000;

export type RefreshResult = 'refreshed' | 'unauthenticated' | 'unavailable';

let inFlight: Promise<RefreshResult> | null = null;

export function toSession(response: AuthSessionResponse, now = Date.now()): AuthSession {
  return { ...response, expiresAt: now + response.expiresIn * 1000 };
}

export function sessionExpiresSoon(expiresAt: number | undefined, now = Date.now()): boolean {
  return !expiresAt || expiresAt - now <= REFRESH_SKEW_MS;
}

async function requestRefresh(): Promise<RefreshResult> {
  try {
    const response = await fetch(`${BASE_URL}${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      return response.status === 401 || response.status === 403
        ? 'unauthenticated'
        : 'unavailable';
    }

    const payload = (await response.json().catch(() => null)) as AuthSessionResponse | null;
    if (!payload?.accessToken) {
      return 'unavailable';
    }

    useAuthStore.getState().setSession(toSession(payload));
    return 'refreshed';
  } catch {
    return 'unavailable';
  }
}

/**
 * Rotates the refresh cookie once, sharing the result across concurrent callers.
 * A network/server failure is not treated as an expired session.
 */
export async function refreshSession(): Promise<RefreshResult> {
  if (!inFlight) {
    inFlight = requestRefresh()
      .then((result) => {
        if (result === 'unauthenticated') {
          useAuthStore.getState().clearSession();
        }
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

/** Returns a usable access token, refreshing it first when it is missing or about to expire. */
export async function getValidAccessToken(): Promise<string | null> {
  const session = useAuthStore.getState().session;
  if (!session) {
    return null;
  }

  if (!sessionExpiresSoon(session.expiresAt)) {
    return session.accessToken;
  }

  await refreshSession();

  return useAuthStore.getState().session?.accessToken ?? null;
}
