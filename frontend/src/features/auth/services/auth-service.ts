import { apiRequest } from '@/lib/api-client';
import type { AuthSession, CurrentSession, LoginInput } from '@/types/auth';

export const authService = {
  login: (input: LoginInput) =>
    apiRequest<AuthSession>('/auth/login', { method: 'POST', body: input, auth: false }),

  refresh: () =>
    apiRequest<AuthSession>('/auth/refresh', { method: 'POST', body: {}, auth: false }),

  logout: () => apiRequest<void>('/auth/logout', { method: 'POST', body: {}, auth: false }),

  me: () => apiRequest<CurrentSession>('/auth/me'),

  switchTenant: (tenantId: string) =>
    apiRequest<AuthSession>('/auth/switch-tenant', { method: 'POST', body: { tenantId } }),
};
