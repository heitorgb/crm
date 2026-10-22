import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { LandingAppPreview } from './landing-app-preview';
import { LandingLinkButton } from './landing-link-button';

const highlights = [
  'Implantação assistida pelo time OrderUp',
  'Acesso pelo navegador, sem instalar',
  'Dados isolados por organização',
];

export function LandingHero() {
  const session = useAuthStore((state) => state.session);
  const loginHref = session ? '/atendimento/conversas' : '/login';

  return (
    <section className="relative px-4 pb-20 pt-14 sm:px-6 lg:px-8 lg:pb-28 lg:pt-20">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:gap-20">
        <div className="landing-fade-up relative">
          <span className="landing-chip">
            <Sparkles className="size-3" aria-hidden="true" />
            Atendimento, CRM e operação em um só lugar
          </span>

          <h1 className="mt-6 text-balance text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.04em] text-white sm:text-[3.2rem] lg:text-[3.35rem] xl:text-[3.7rem]">
            Todas as conversas.
            <span className="landing-heading-gradient block">Uma só operação.</span>
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-[15px] leading-relaxed text-white/60 sm:text-base">
            Centralize seus canais de atendimento, organize suas conversas e dê mais produtividade
            à sua equipe em uma única plataforma.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LandingLinkButton href="#planos">
              Conhecer planos
              <ArrowRight aria-hidden="true" />
            </LandingLinkButton>
            <LandingLinkButton href={loginHref} variant="secondary">
              {session ? 'Abrir plataforma' : 'Entrar na plataforma'}
            </LandingLinkButton>
          </div>

          <ul className="mt-8 grid gap-2.5 text-[12.5px] text-white/50 sm:grid-cols-2">
            {highlights.map((highlight) => (
              <li key={highlight} className="flex items-start gap-2">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
                  <Check className="size-2.5" aria-hidden="true" />
                </span>
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <div className="landing-fade-up landing-fade-up-delay relative">
          <div
            className="pointer-events-none absolute -inset-8 rounded-[2.5rem] bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.14),transparent_68%)] blur-2xl"
            aria-hidden="true"
          />
          <LandingAppPreview />
        </div>
      </div>
    </section>
  );
}
