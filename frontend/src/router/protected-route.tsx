import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from '@/components/common/page-loader';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';

interface ProtectedRouteProps {
  children: ReactElement;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const session = useAuthStore((state) => state.session);
  const status = useAuthStore((state) => state.status);
  const setStatus = useAuthStore((state) => state.setStatus);
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return <PageLoader label="Verificando sua sessão…" className="min-h-dvh" />;
  }

  if (status === 'unavailable') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Não foi possível verificar sua sessão. Verifique sua conexão e tente novamente.
        </p>
        <Button type="button" onClick={() => setStatus('idle')}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
