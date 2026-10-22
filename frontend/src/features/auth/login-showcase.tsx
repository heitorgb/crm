import {
  Bell,
  CheckCheck,
  Clock3,
  MessageCircleMore,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

const benefits = [
  {
    icon: MessagesSquare,
    title: 'Múltiplos WhatsApps',
    description: 'Conecte seus números e acompanhe tudo em um só lugar.',
  },
  {
    icon: Clock3,
    title: 'Histórico centralizado',
    description: 'Conversas organizadas por contato, sem perder o contexto.',
  },
  {
    icon: ShieldCheck,
    title: 'Isolamento por organização',
    description: 'Cada equipe acessa apenas os dados da própria operação.',
  },
  {
    icon: Zap,
    title: 'Atendimento mais ágil',
    description: 'Encontre contatos e responda com poucos cliques.',
  },
];

function PreviewCards() {
  return (
    <div
      className="pointer-events-none absolute right-4 top-1/2 hidden w-64 -translate-y-1/2 flex-col gap-4 min-[1440px]:flex"
      aria-hidden="true"
    >
      <div className="auth-float ml-auto w-full rounded-xl border border-white/10 bg-[var(--auth-surface)] p-4 shadow-[0_24px_60px_-36px_rgba(0,0,0,0.95)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/15">
              <MessageCircleMore className="size-4" />
            </span>
            <div>
              <p className="text-xs font-medium">Novo atendimento</p>
              <p className="text-[10.5px] text-[var(--auth-muted)]">WhatsApp conectado</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            Agora
          </span>
        </div>
        <p className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-[11px] leading-relaxed text-[var(--auth-muted-strong)]">
          Olá! Gostaria de saber mais sobre o atendimento.
        </p>
        <div className="mt-2.5 flex items-center gap-1.5 text-[10.5px] text-[var(--auth-muted)]">
          <CheckCheck className="size-3.5 text-emerald-400" />
          Conversa centralizada
        </div>
      </div>

      <div className="auth-float-slow -ml-6 w-60 rounded-xl border border-white/10 bg-[var(--auth-surface)] p-4 shadow-[0_24px_60px_-36px_rgba(0,0,0,0.95)]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-300 ring-1 ring-inset ring-cyan-400/15">
            <Bell className="size-4" />
          </span>
          <div>
            <p className="text-xs font-medium">Tudo sob controle</p>
            <p className="text-[10.5px] text-[var(--auth-muted)]">Notificações</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
          <span className="text-[var(--auth-muted-strong)]">Fila de atendimento</span>
          <span className="font-medium text-emerald-300">Organizada</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" />
        </div>
      </div>
    </div>
  );
}

export function LoginShowcase() {
  return (
    <section className="relative hidden min-h-dvh flex-col overflow-hidden border-r border-white/[0.06] px-10 py-10 lg:flex xl:px-14 2xl:px-16">
      <div className="auth-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <header className="relative flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <img
            src="/images/logo-orderup.png"
            alt="OrderUp"
            className="size-11 rounded-xl shadow-[0_10px_30px_-14px_rgba(0,0,0,0.9)] ring-1 ring-white/10"
          />
          <div>
            <p className="text-[15px] font-semibold tracking-tight">OrderUp CRM</p>
            <p className="text-[10.5px] uppercase tracking-[0.2em] text-[var(--auth-muted)]">
              Atendimento omnichannel
            </p>
          </div>
        </div>

      </header>

      <div className="relative flex flex-1 flex-col justify-center py-12">
        <div className="max-w-[26rem] 2xl:max-w-[30rem]">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-3 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-emerald-300">
            <Sparkles className="size-3" />
            Centralize seu atendimento
          </span>

          <h1 className="mt-6 text-balance text-[2.45rem] font-semibold leading-[1.06] tracking-[-0.035em] xl:text-[2.5rem] 2xl:text-[2.8rem]">
            Todas as conversas.
            <span className="auth-heading-gradient block">Uma só operação.</span>
          </h1>

          <p className="mt-5 max-w-[24rem] text-[15px] 2xl:max-w-[27rem] leading-relaxed text-[var(--auth-muted)]">
            Reúna canais, contatos e histórico em um ambiente pensado para equipes de atendimento
            que precisam de contexto, velocidade e organização.
          </p>

          <ul className="mt-9 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {benefits.map((benefit) => (
              <li key={benefit.title} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-emerald-400/15 bg-emerald-500/10 text-emerald-300">
                  <benefit.icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-snug text-[var(--auth-foreground)]">
                    {benefit.title}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--auth-muted)]">
                    {benefit.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <PreviewCards />

      <footer className="relative flex items-center justify-between gap-4 border-t border-white/[0.06] pt-5 text-[11px] text-[var(--auth-muted)]">
        <span>© {new Date().getFullYear()} OrderUp CRM</span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-emerald-400/80" />
          Dados isolados por organização
        </span>
      </footer>
    </section>
  );
}
