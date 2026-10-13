import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/query-client';
import { RealtimeProvider } from './realtime-provider';
import { ThemeProvider } from './theme-provider';

export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RealtimeProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </RealtimeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
