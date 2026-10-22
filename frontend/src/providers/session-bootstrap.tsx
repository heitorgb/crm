import { useEffect, type ReactElement, type ReactNode } from 'react';
import { refreshSession } from '@/lib/session-refresh';
import { useAuthStore } from '@/stores/auth-store';

export function SessionBootstrap({ children }: { children: ReactNode }): ReactElement {
  const status = useAuthStore((state) => state.status);
  const setStatus = useAuthStore((state) => state.setStatus);

  useEffect(() => {
    if (status !== 'idle') {
      return;
    }

    setStatus('loading');

    void refreshSession().then((result) => {
      const state = useAuthStore.getState();

      if (result === 'refreshed') {
        state.setStatus(state.session ? 'authenticated' : 'unauthenticated');
        return;
      }

      state.setStatus(result === 'unauthenticated' ? 'unauthenticated' : 'unavailable');
    });
  }, [status, setStatus]);

  return <>{children}</>;
}
