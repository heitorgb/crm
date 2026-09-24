import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function MainContent({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isChat = pathname === '/atendimento/conversas';
  return (
    <main className="flex-1 overflow-y-auto scrollbar-thin">
      <div className={cn('mx-auto w-full p-4 sm:p-6', !isChat && 'max-w-[1360px]')}>{children}</div>
    </main>
  );
}
