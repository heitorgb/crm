import { AppProviders } from '@/providers/app-providers';
import { AppRoutes } from '@/router/app-routes';

export function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
