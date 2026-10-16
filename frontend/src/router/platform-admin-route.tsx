import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';

interface PlatformAdminRouteProps {
  children: ReactElement;
}

/**
 * UI mirror of the backend PlatformAdminGuard for the /admin area. The backend
 * remains the source of truth; this only avoids rendering admin screens for
 * users who are not platform administrators.
 */
export function PlatformAdminRoute({ children }: PlatformAdminRouteProps) {
  const platformAdmin = useAuthStore((state) => state.platformAdmin);

  if (!platformAdmin) {
    return <Navigate to="/atendimento/conversas" replace />;
  }

  return children;
}
