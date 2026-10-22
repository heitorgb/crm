import { ArrowRight, MessagesSquare } from 'lucide-react';
import { LandingLinkButton } from './landing-link-button';

export function LandingCta() {
  return (
    <section className="relative px-4 pb-20 pt-4 sm:px-6 lg:px-8 lg:pb-24">
      <div className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-3xl border border-emerald-400/15 bg-[linear-gradient(135deg,rgba(34,197,94,0.14),rgba(10,13,19,0.96)_52%,rgba(6,182,212,0.08))] px-6 py-12 text-center shadow-[0_50px_120px_-60px_rgba(34,197,94,0.45)] sm:px-10 lg:px-16 lg:py-16">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent"
            aria-hidden="true"
          />
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-300">
            <MessagesSquare className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mx-auto mt-6 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Organize seu atendimento em um só lugar.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Conheça os planos do OrderUp CRM e encontre a opção adequada para a sua operação.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LandingLinkButton href="#planos">
              Ver planos
              <ArrowRight aria-hidden="true" />
            </LandingLinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
