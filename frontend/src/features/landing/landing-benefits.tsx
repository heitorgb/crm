import { LANDING_BENEFITS } from './landing-content';

export function LandingBenefits() {
  return (
    <section id="beneficios" className="relative scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <span className="landing-eyebrow">Benefícios</span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Menos abas abertas. Mais controle da operação.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/55">
            Uma experiência pensada para equipes que precisam de contexto, velocidade e organização
            no dia a dia do atendimento.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING_BENEFITS.map((benefit) => (
            <article
              key={benefit.title}
              className="landing-surface group rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400/20"
            >
              <span className="grid size-10 place-items-center rounded-xl border border-emerald-400/15 bg-emerald-500/10 text-emerald-300">
                <benefit.icon className="size-[18px]" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-white">
                {benefit.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">{benefit.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
