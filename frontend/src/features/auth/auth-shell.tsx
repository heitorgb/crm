import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  description: string;
  badge: ReactNode;
  children: ReactNode;
}

export function AuthShell({ title, description, badge, children }: AuthShellProps) {
  return (
    <div className="auth-screen relative min-h-dvh overflow-hidden">
      <div className="auth-canvas pointer-events-none absolute inset-0" aria-hidden="true" />

      <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6">
        <div className="w-full max-w-[26rem]">
          <div className="mb-6 flex items-center gap-3">
            <img
              src="/images/logo-orderup.png"
              alt="OrderUp"
              className="size-11 rounded-xl shadow-[0_10px_30px_-14px_rgba(0,0,0,0.9)] ring-1 ring-white/10"
            />
            <div>
              <p className="text-base font-semibold tracking-tight">OrderUp CRM</p>
              <p className="text-xs text-[var(--auth-muted)]">Atendimento omnichannel</p>
            </div>
          </div>

          <div className="auth-form-surface rounded-2xl p-6 sm:p-8">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-3 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-emerald-300">
                {badge}
              </span>
              <h1 className="text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.85rem]">
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-[var(--auth-muted)]">{description}</p>
            </div>

            <div className="mt-7">{children}</div>
          </div>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-[var(--auth-muted)]">
            © {new Date().getFullYear()} OrderUp CRM. Todos os direitos reservados.
          </p>
        </div>
      </main>
    </div>
  );
}
