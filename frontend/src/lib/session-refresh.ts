import { useAuthStore } from '@/stores/auth-store';
import type { AuthSession, AuthSessionResponse } from '@/types/auth';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const API_PREFIX = '/api';

export const REFRESH_SKEW_MS = 30_000;

let inFlight: Promise<boolean> | null = null;

export function toSession(response: AuthSessionResponse, now = Date.now()): AuthSession {
  return { ...response, expiresAt: now + response.expiresIn * 1000 };
}

export function sessionExpiresSoon(expiresAt: number | undefined, now = Date.now()): boolean {
  return !expiresAt || expiresAt - now <= REFRESH_SKEW_MS;
}

async function requestRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json().catch(() => null)) as AuthSessionResponse | null;
    if (!payload?.accessToken) {
      return false;
    }

    useAuthStore.getState().setSession(toSession(payload));
    return true;
  } catch {
    return false;
  }
}

/** Rotates the refresh cookie once, sharing the result across concurrent callers. */
export async function refreshSession(): Promise<boolean> {
  if (!inFlight) {
    inFlight = requestRefresh().finally(() => {
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

  const refreshed = await refreshSession();
  if (!refreshed) {
    useAuthStore.getState().clearSession();
    return null;
  }

  return useAuthStore.getState().session?.accessToken ?? null;
}
