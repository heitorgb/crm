import { apiRequest } from '@/lib/api-client';
import type {
  AuthSessionResponse,
  AuthUser,
  ChangePasswordInput,
  CurrentSession,
  ForgotPasswordInput,
  ForgotPasswordResponse,
  LoginInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from '@/types/auth';

export const authService = {
  login: (input: LoginInput) =>
    apiRequest<AuthSessionResponse>('/auth/login', { method: 'POST', body: input, auth: false }),

  refresh: () =>
    apiRequest<AuthSessionResponse>('/auth/refresh', { method: 'POST', body: {}, auth: false }),

  logout: () => apiRequest<void>('/auth/logout', { method: 'POST', body: {}, auth: false }),

  me: () => apiRequest<CurrentSession>('/auth/me'),

  updateProfile: (input: UpdateProfileInput) =>
    apiRequest<AuthUser>('/auth/me', { method: 'PATCH', body: input }),

  changePassword: (input: ChangePasswordInput) =>
    apiRequest<void>('/auth/change-password', { method: 'POST', body: input }),

  forgotPassword: (input: ForgotPasswordInput) =>
    apiRequest<ForgotPasswordResponse>('/auth/forgot-password', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  resetPassword: (input: ResetPasswordInput) =>
    apiRequest<void>('/auth/reset-password', { method: 'POST', body: input, auth: false }),

  switchTenant: (tenantId: string) =>
    apiRequest<AuthSessionResponse>('/auth/switch-tenant', { method: 'POST', body: { tenantId } }),
};
