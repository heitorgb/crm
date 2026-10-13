import { useEffect, type ReactElement, type ReactNode } from 'react';
import { realtimeStore } from '@/lib/realtime-store';
import { useAuthStore } from '@/stores/auth-store';

export function RealtimeProvider({ children }: { children: ReactNode }): ReactElement {
  const token = useAuthStore((state) => state.session?.accessToken);

  useEffect(() => {
    if (token) {
      realtimeStore.connect(token);
    } else {
      realtimeStore.disconnect();
    }
  }, [token]);

  return <>{children}</>;
}
