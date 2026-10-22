import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { REFRESH_SKEW_MS, refreshSession, toSession } from '@/lib/session-refresh';
import { useAuthStore } from '@/stores/auth-store';
import { authService } from './services/auth-service';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from '@/types/auth';

export const authKeys = {
  all: ['auth'] as const,
  me: ['auth', 'me'] as const,
};

export function useLogin(onAuthenticated?: (input: LoginInput) => void) {
  const setSession = useAuthStore((state) => state.setSession);
  const setMemberships = useAuthStore((state) => state.setMemberships);
  const setPlatformAdmin = useAuthStore((state) => state.setPlatformAdmin);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: LoginInput) => authService.login(input),
    onSuccess: async (session, input) => {
      setSession(toSession(session));

      try {
        const current = await authService.me();
        setMemberships(current.memberships);
        setPlatformAdmin(current.isPlatformAdmin);
      } catch {
        setMemberships([]);
        setPlatformAdmin(false);
      }

      onAuthenticated?.(input);
      navigate('/atendimento/conversas', { replace: true });
    },
  });
}

export function useLogout() {
  const clearSession = useAuthStore((state) => state.clearSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => authService.logout(),
    onSettled: () => {
      clearSession();
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
}

export function useSwitchTenant() {
  const setSession = useAuthStore((state) => state.setSession);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tenantId: string) => authService.switchTenant(tenantId),
    onSuccess: (session) => {
      setSession(toSession(session));
      void queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export function useUpdateProfile() {
  const updateUser = useAuthStore((state) => state.updateUser);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProfileInput) => authService.updateProfile(input),
    onSuccess: (user) => {
      updateUser(user);
      void queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => authService.changePassword(input),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) => authService.forgotPassword(input),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => authService.resetPassword(input),
  });
}

export function useSessionSync() {
  const session = useAuthStore((state) => state.session);
  const setMemberships = useAuthStore((state) => state.setMemberships);
  const setPlatformAdmin = useAuthStore((state) => state.setPlatformAdmin);

  const query = useQuery({
    queryKey: authKeys.me,
    queryFn: () => authService.me(),
    enabled: Boolean(session),
  });

  useEffect(() => {
    if (!session) {
      return;
    }

    const remaining = session.expiresAt - Date.now();
    const delay = Math.max(
      remaining > REFRESH_SKEW_MS ? remaining - REFRESH_SKEW_MS : remaining + 1000,
      1000,
    );
    const timer = window.setTimeout(() => {
      void refreshSession();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (query.data) {
      setMemberships(query.data.memberships);
      setPlatformAdmin(query.data.isPlatformAdmin);
    }
  }, [query.data, setMemberships, setPlatformAdmin]);

  return query;
}
