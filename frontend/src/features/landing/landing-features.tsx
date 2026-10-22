import type { LucideIcon } from 'lucide-react';
import {
  CalendarClock,
  CheckCheck,
  Clock3,
  KanbanSquare,
  MessageCircleMore,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
  Webhook,
  Zap,
} from 'lucide-react';

interface FeatureHeadingProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

function FeatureHeading({ icon: Icon, title, description }: FeatureHeadingProps) {
  return (
    <div>
      <span className="grid size-9 place-items-center rounded-lg border border-emerald-400/15 bg-emerald-500/10 text-emerald-300">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-lg font-semibold tracking-[-0.02em] text-white">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-white/50">{description}</p>
    </div>
  );
}

function InboxPreview() {
  const items = [
    { name: 'Mariana Costa', text: 'Pode enviar a proposta por aqui?', status: 'Em atendimento', tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/15' },
    { name: 'Carlos Menezes', text: 'Retorno amanhã pela manhã.', status: 'Aguardando', tone: 'text-amber-200 bg-amber-500/10 border-amber-400/15' },
    { name: 'Studio Aurora', text: 'Obrigada pelo retorno!', status: 'Resolvido', tone: 'text-cyan-200 bg-cyan-500/10 border-cyan-400/15' },
  ];

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0b0e14]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">
          Caixa de entrada
        </p>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[8.5px] font-medium text-emerald-300">
          12 abertas
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {items.map((item) => (
          <div key={item.name} className="flex items-center gap-3 px-3 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-[8.5px] font-semibold text-white/60">
              {item.name
                .split(' ')
                .map((part) => part[0])
                .join('')
                .slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium text-white/75">{item.name}</p>
              <p className="truncate text-[8.5px] text-white/35">{item.text}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[7.5px] ${item.tone}`}>
              {item.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductivityPreview() {
  return (
    <div className="mt-6 space-y-2.5">
      <div className="rounded-xl border border-white/[0.06] bg-[#0b0e14] p-3">
        <div className="flex items-center gap-2">
          <Zap className="size-3.5 text-emerald-300" aria-hidden="true" />
          <p className="text-[10px] font-medium text-white/75">Resposta rápida</p>
          <span className="ml-auto rounded bg-white/[0.05] px-1.5 py-0.5 text-[7px] text-white/35">
            /proposta
          </span>
        </div>
        <p className="mt-2 rounded-lg border border-white/[0.05] bg-white/[0.03] px-2.5 py-2 text-[8.5px] leading-relaxed text-white/45">
          Olá! Segue a proposta com os detalhes do OrderUp CRM. Qualquer dúvida, estou por aqui.
        </p>
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-[#0b0e14] px-3 py-2.5">
        <CalendarClock className="size-3.5 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-white/75">Mensagem agendada</p>
          <p className="text-[8px] text-white/35">Follow-up · amanhã às 09:00</p>
        </div>
        <Clock3 className="size-3 text-white/25" aria-hidden="true" />
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] px-3 py-2.5">
        <Sparkles className="size-3.5 text-emerald-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-emerald-100/90">Copiloto comercial</p>
          <p className="text-[8px] text-emerald-100/45">Próxima ação sugerida para o lead</p>
        </div>
        <CheckCheck className="size-3 text-emerald-300/70" aria-hidden="true" />
      </div>
    </div>
  );
}

function PipelinePreview() {
  const columns = [
    { title: 'Novo', cards: ['Studio Aurora', 'Rafael Lima'] },
    { title: 'Em conversa', cards: ['Mariana Costa'] },
    { title: 'Proposta', cards: ['Carlos Menezes'] },
  ];

  return (
    <div className="mt-6 grid grid-cols-3 gap-2">
      {columns.map((column) => (
        <div key={column.title} className="rounded-lg border border-white/[0.06] bg-[#0b0e14] p-2">
          <p className="flex items-center justify-between text-[8px] font-medium uppercase tracking-[0.1em] text-white/35">
            {column.title}
            <span className="text-white/20">{column.cards.length}</span>
          </p>
          <div className="mt-2 space-y-1.5">
            {column.cards.map((card) => (
              <div
                key={card}
                className="rounded-md border border-white/[0.06] bg-white/[0.035] px-2 py-1.5 text-[8px] text-white/60"
              >
                {card}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function OperationsPreview() {
  const resources = [
    { icon: Smartphone, label: 'Números de WhatsApp' },
    { icon: Users, label: 'Equipe e permissões' },
    { icon: Wallet, label: 'Cobranças e lembretes' },
    { icon: Webhook, label: 'Webhooks e integrações' },
  ];

  return (
    <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
      {resources.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-[#0b0e14] px-3 py-2.5"
        >
          <span className="grid size-6 place-items-center rounded-md bg-white/[0.05] text-emerald-300/90">
            <Icon className="size-3" aria-hidden="true" />
          </span>
          <span className="text-[9.5px] text-white/60">{label}</span>
        </div>
      ))}
    </div>
  );
}

export function LandingFeatures() {
  return (
    <section
      id="funcionalidades"
      className="relative scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8 lg:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <span className="landing-eyebrow">Funcionalidades</span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
              Feito para o ritmo do seu atendimento.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-white/55">
              Recursos que já fazem parte da operação do OrderUp CRM, organizados para reduzir
              cliques e dar contexto para o time.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-[11px] text-white/45">
            <ShieldCheck className="size-3.5 text-emerald-300" aria-hidden="true" />
            Interface real, dados isolados por organização
          </div>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-12">
          <article className="landing-surface rounded-2xl p-5 sm:p-6 lg:col-span-7">
            <FeatureHeading
              icon={MessageCircleMore}
              title="Caixa de entrada e atendimento"
              description="Uma fila única para o time acompanhar conversas, status e prioridades sem perder o contexto de cada cliente."
            />
            <InboxPreview />
          </article>

          <article className="landing-surface rounded-2xl p-5 sm:p-6 lg:col-span-5">
            <FeatureHeading
              icon={Zap}
              title="Produtividade no dia a dia"
              description="Respostas rápidas, mensagens agendadas e o copiloto comercial ajudam a equipe a responder melhor, mais rápido."
            />
            <ProductivityPreview />
          </article>

          <article className="landing-surface rounded-2xl p-5 sm:p-6 lg:col-span-5">
            <FeatureHeading
              icon={KanbanSquare}
              title="Organização comercial"
              description="Oportunidades em pipeline, etiquetas e histórico de interações mantêm o avanço do time visível."
            />
            <PipelinePreview />
          </article>

          <article className="landing-surface rounded-2xl p-5 sm:p-6 lg:col-span-7">
            <FeatureHeading
              icon={ShieldCheck}
              title="Configurações e gestão da operação"
              description="Controle números de WhatsApp, equipe, módulos, cobranças e integrações em um ambiente seguro."
            />
            <OperationsPreview />
          </article>
        </div>
      </div>
    </section>
  );
}
