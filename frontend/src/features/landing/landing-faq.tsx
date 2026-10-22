import { ChevronDown } from 'lucide-react';
import { LANDING_FAQ } from './landing-content';

export function LandingFaq() {
  return (
    <section id="faq" className="relative scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
        <div>
          <span className="landing-eyebrow">Perguntas frequentes</span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Dúvidas antes de começar?
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/55">
            Reunimos as respostas sobre o produto, a contratação e o acesso à plataforma. Se precisar
            de algo específico, fale com o time comercial.
          </p>
        </div>

        <div className="space-y-3">
          {LANDING_FAQ.map((item) => (
            <details
              key={item.question}
              className="group rounded-xl border border-white/[0.08] bg-white/[0.025] px-5 py-4 transition-colors open:border-emerald-400/20 open:bg-white/[0.04]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-[13.5px] font-medium text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="size-4 shrink-0 text-white/35 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-3 border-t border-white/[0.06] pt-3 text-[12.5px] leading-relaxed text-white/50">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
