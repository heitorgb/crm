import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { PageLoader } from '@/components/common/page-loader';
import { useEnabledModules } from './queries';

interface ModuleRouteProps {
  moduleKey: string;
  children: ReactElement;
}

/**
 * Blocks direct navigation to routes whose module is disabled for the current
 * organization. The backend guard remains the source of truth; this only keeps
 * the UI consistent and redirects to a safe page.
 */
export function ModuleRoute({ moduleKey, children }: ModuleRouteProps) {
  const enabled = useEnabledModules();

  if (enabled.isPending) {
    return <PageLoader />;
  }

  if (enabled.data && !enabled.data.includes(moduleKey)) {
    return <Navigate to="/indisponivel" replace />;
  }

  return children;
}
