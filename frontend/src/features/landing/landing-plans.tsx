import {
  ArrowRight,
  CalendarClock,
  Check,
  KanbanSquare,
  MessageCircle,
  MessagesSquare,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
  Webhook,
  Zap,
} from 'lucide-react';
import { CONTACT_EMAIL, WHATSAPP_URL } from './landing-content';
import { LandingLinkButton } from './landing-link-button';

const includedResources = [
  { icon: MessagesSquare, label: 'Caixa de entrada e histórico de atendimento' },
  { icon: Smartphone, label: 'Integração com múltiplos números de WhatsApp' },
  { icon: Users, label: 'Gestão de contatos e equipe por organização' },
  { icon: KanbanSquare, label: 'Oportunidades, pipeline e etiquetas de CRM' },
  { icon: Zap, label: 'Respostas rápidas e copiloto comercial' },
  { icon: CalendarClock, label: 'Mensagens agendadas e follow-ups' },
  { icon: Wallet, label: 'Cobranças, recorrências e lembretes' },
  { icon: Webhook, label: 'Webhooks e integrações via API' },
  { icon: ShieldCheck, label: 'Autenticação, permissões e isolamento por tenant' },
];

export function LandingPlans() {
  return (
    <section id="planos" className="relative scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="landing-eyebrow">Planos</span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Um plano desenhado para a sua operação.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/55">
            O OrderUp CRM é contratado com o time comercial. As condições consideram o tamanho da
            equipe, os números de WhatsApp e os módulos necessários para o seu cenário.
          </p>
        </div>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col justify-between rounded-2xl border border-emerald-400/20 bg-[linear-gradient(160deg,rgba(34,197,94,0.12),rgba(14,17,24,0.92)_46%)] p-6 shadow-[0_40px_100px_-50px_rgba(34,197,94,0.35)] sm:p-7">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-300">
                <Sparkles className="size-3" aria-hidden="true" />
                Contratação assistida
              </span>

              <h3 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-white">
                OrderUp CRM
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">
                Acesso à plataforma com os módulos definidos na contratação, junto ao seu time.
              </p>

              <div className="mt-7 border-t border-white/[0.08] pt-6">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Investimento
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">
                  Sob consulta
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-white/45">
                  Condições comerciais e limites definidos na contratação. Não há cobrança
                  automática nesta página.
                </p>
              </div>

              <ul className="mt-6 space-y-2 text-[12px] text-white/55">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                  Implantação com o time OrderUp
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                  Cadastro da organização vinculado ao plano
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                  Sem cadastro público independente
                </li>
              </ul>
            </div>

            <div className="mt-8 space-y-2.5">
              <LandingLinkButton href={WHATSAPP_URL} className="w-full">
                Falar com o comercial
                <ArrowRight aria-hidden="true" />
              </LandingLinkButton>
              <LandingLinkButton href="/login" variant="secondary" className="w-full">
                Já sou cliente · Entrar
              </LandingLinkButton>
              <p className="text-center text-[10.5px] text-white/35">
                Prefere e-mail?{' '}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-white/60 underline decoration-white/20 underline-offset-2 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
                >
                  {CONTACT_EMAIL}
                </a>
              </p>
            </div>
          </div>

          <div className="landing-surface flex flex-col rounded-2xl p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">
                  O que está incluído
                </p>
                <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                  Recursos da plataforma
                </h3>
                <p className="mt-1.5 text-[11px] text-white/35">
                  A disponibilidade de cada módulo é definida na contratação.
                </p>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-400/15 bg-emerald-500/10 text-emerald-300">
                <MessageCircle className="size-[18px]" aria-hidden="true" />
              </span>
            </div>

            <ul className="mt-6 grid flex-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {includedResources.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-white/60">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-white/[0.05] text-emerald-300/90">
                    <Icon className="size-3" aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 text-[11.5px] leading-relaxed text-white/45">
              <strong className="font-medium text-white/70">Como começar:</strong> fale com o time
              comercial, alinhe as condições e receba o provisionamento da sua organização e do
              acesso do administrador. Todo novo cliente entra pela contratação de um plano.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
