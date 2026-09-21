import type { ReactNode } from 'react';

export function MainContent({ children }: { children: ReactNode }) {
  return (
    <main className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-[1360px] p-4 sm:p-6">{children}</div>
    </main>
  );
}
