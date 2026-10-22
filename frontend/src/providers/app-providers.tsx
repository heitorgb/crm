import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/query-client';
import { RealtimeProvider } from './realtime-provider';
import { SessionBootstrap } from './session-bootstrap';
import { ThemeProvider } from './theme-provider';

export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SessionBootstrap>
          <RealtimeProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </RealtimeProvider>
        </SessionBootstrap>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
