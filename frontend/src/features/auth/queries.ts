import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { authService } from './services/auth-service';
import type { LoginInput } from '@/types/auth';

export const authKeys = {
  all: ['auth'] as const,
  me: ['auth', 'me'] as const,
};

export function useLogin() {
  const setSession = useAuthStore((state) => state.setSession);
  const setMemberships = useAuthStore((state) => state.setMemberships);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: LoginInput) => authService.login(input),
    onSuccess: async (session) => {
      setSession(session);

      try {
        const current = await authService.me();
        setMemberships(current.memberships);
      } catch {
        setMemberships([]);
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
      setSession(session);
      void queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export function useSessionSync() {
  const session = useAuthStore((state) => state.session);
  const setMemberships = useAuthStore((state) => state.setMemberships);

  const query = useQuery({
    queryKey: authKeys.me,
    queryFn: () => authService.me(),
    enabled: Boolean(session),
  });

  useEffect(() => {
    if (query.data) {
      setMemberships(query.data.memberships);
    }
  }, [query.data, setMemberships]);

  return query;
}
