import { useAuthStore } from '@/stores/auth-store';

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

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = options;
  const token = auth ? useAuthStore.getState().session?.accessToken : undefined;

  const response = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = useAuthStore.getState().session?.accessToken;

  const response = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

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
  const token = useAuthStore.getState().session?.accessToken;

  const response = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

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
