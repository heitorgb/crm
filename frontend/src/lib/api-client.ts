import { useAuthStore } from '@/stores/auth-store';
import { getValidAccessToken, refreshSession } from '@/lib/session-refresh';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const API_PREFIX = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
}

function withAuthHeader(headers: HeadersInit | undefined, token: string | null): Headers {
  const next = new Headers(headers);
  if (token) {
    next.set('Authorization', `Bearer ${token}`);
  }
  return next;
}

/**
 * Authenticated fetch that refreshes the access token proactively and once on a
 * 401, so an expired token never forces the operator to log in again.
 */
async function apiFetch(path: string, init: RequestInit, auth: boolean): Promise<Response> {
  const url = `${BASE_URL}${API_PREFIX}${path}`;
  const token = auth ? await getValidAccessToken() : null;

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: withAuthHeader(init.headers, token),
  });

  if (!auth || response.status !== 401) {
    return response;
  }

  const refreshed = await refreshSession();
  if (!refreshed) {
    useAuthStore.getState().clearSession();
    return response;
  }

  const retryToken = useAuthStore.getState().session?.accessToken ?? null;
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: withAuthHeader(init.headers, retryToken),
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = options;

  const response = await apiFetch(
    path,
    {
      ...rest,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    auth,
  );

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as
    | { code?: string; message?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.code ?? 'REQUEST_FAILED',
      payload?.message ?? 'Não foi possível concluir a requisição.',
    );
  }

  return payload as T;
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<T> {
  const response = await apiFetch(path, { method, body: formData }, true);

  const payload = (await response.json().catch(() => null)) as
    | { code?: string; message?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.code ?? 'REQUEST_FAILED',
      payload?.message ?? 'Não foi possível enviar o arquivo.',
    );
  }

  return payload as T;
}

export async function apiRequestBlob(path: string): Promise<Blob> {
  const response = await apiFetch(path, {}, true);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { code?: string; message?: string }
      | null;
    throw new ApiError(
      response.status,
      payload?.code ?? 'REQUEST_FAILED',
      payload?.message ?? 'Não foi possível carregar o arquivo.',
    );
  }

  return response.blob();
}
