import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { REFRESH_SKEW_MS, refreshSession, toSession } from '@/lib/session-refresh';
import { useAuthStore } from '@/stores/auth-store';
import { authService } from './services/auth-service';
import type { ChangePasswordInput, LoginInput, UpdateProfileInput } from '@/types/auth';

export const authKeys = {
  all: ['auth'] as const,
  me: ['auth', 'me'] as const,
};

export function useLogin() {
  const setSession = useAuthStore((state) => state.setSession);
  const setMemberships = useAuthStore((state) => state.setMemberships);
  const setPlatformAdmin = useAuthStore((state) => state.setPlatformAdmin);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: LoginInput) => authService.login(input),
    onSuccess: async (session) => {
      setSession(toSession(session));

      try {
        const current = await authService.me();
        setMemberships(current.memberships);
        setPlatformAdmin(current.isPlatformAdmin);
      } catch {
        setMemberships([]);
        setPlatformAdmin(false);
      }

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

    const delay = Math.max(session.expiresAt - Date.now() - REFRESH_SKEW_MS, 0);
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
