import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

const FULL_BLEED_ROUTES = ['/atendimento/conversas'];

export function MainContent({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const fullBleed = FULL_BLEED_ROUTES.some((route) => pathname.startsWith(route));

  if (fullBleed) {
    return (
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto scrollbar-thin">
      <div className={cn('mx-auto w-full p-4 sm:p-6', !isChat && 'max-w-[1360px]')}>{children}</div>
    </main>
  );
}
