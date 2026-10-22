import {
  CheckCheck,
  Clock3,
  KanbanSquare,
  MessageCircleMore,
  Paperclip,
  Search,
  Send,
  Settings,
  Smile,
  Users,
} from 'lucide-react';

const conversations = [
  {
    initials: 'MC',
    name: 'Mariana Costa',
    message: 'Perfeito! Pode enviar a proposta por aqui?',
    time: '09:42',
    unread: '2',
    tone: 'bg-emerald-500/15 text-emerald-300',
  },
  {
    initials: 'CM',
    name: 'Carlos Menezes',
    message: 'Consigo retornar amanhã pela manhã.',
    time: '09:18',
    unread: null,
    tone: 'bg-cyan-500/15 text-cyan-300',
  },
  {
    initials: 'SA',
    name: 'Studio Aurora',
    message: 'Obrigada pelo retorno!',
    time: 'Ontem',
    unread: null,
    tone: 'bg-violet-500/15 text-violet-300',
  },
  {
    initials: 'RL',
    name: 'Rafael Lima',
    message: 'Vou avaliar com o time e te aviso.',
    time: 'Ontem',
    unread: null,
    tone: 'bg-amber-500/15 text-amber-200',
  },
];

export function LandingAppPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[660px]">
      <div
        className="landing-surface overflow-hidden rounded-2xl p-1.5 shadow-[0_48px_120px_-48px_rgba(0,0,0,0.95)]"
        role="img"
        aria-label="Demonstração visual da caixa de entrada do OrderUp CRM, com lista de conversas, histórico de mensagens e painel de contato."
      >
        <div className="flex items-center gap-3 rounded-t-xl border-b border-white/[0.07] bg-[#0b0e14] px-3 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="size-2 rounded-full bg-red-400/70" />
            <span className="size-2 rounded-full bg-amber-400/70" />
            <span className="size-2 rounded-full bg-emerald-400/70" />
          </div>
          <div className="mx-auto flex min-w-0 items-center gap-2 truncate rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[9.5px] text-white/40">
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
            crm.orderup.com.br/atendimento/conversas
          </div>
          <span className="hidden text-[9px] text-white/25 sm:block">OrderUp CRM</span>
        </div>

        <div className="grid min-h-[390px] grid-cols-1 bg-[#0b0e14] sm:grid-cols-[142px_minmax(0,1fr)]">
          <aside className="hidden border-r border-white/[0.06] bg-[#0a0d12] p-2.5 sm:block">
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <img
                src="/images/logo-orderup.png"
                alt=""
                className="size-5 rounded-md ring-1 ring-white/10"
              />
              <span className="text-[10px] font-semibold text-white/85">OrderUp</span>
            </div>

            <nav className="mt-3 space-y-0.5" aria-label="Exemplo de navegação">
              <span className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[9.5px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/10">
                <MessageCircleMore className="size-3" aria-hidden="true" />
                Conversas
              </span>
              <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[9.5px] text-white/40">
                <Users className="size-3" aria-hidden="true" />
                Contatos
              </span>
              <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[9.5px] text-white/40">
                <KanbanSquare className="size-3" aria-hidden="true" />
                Oportunidades
              </span>
              <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[9.5px] text-white/40">
                <Clock3 className="size-3" aria-hidden="true" />
                Agendadas
              </span>
              <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[9.5px] text-white/40">
                <Settings className="size-3" aria-hidden="true" />
                Configurações
              </span>
            </nav>

            <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
              <p className="text-[8.5px] uppercase tracking-[0.14em] text-white/35">Fila do time</p>
              <div className="mt-2 flex items-center justify-between text-[9px] text-white/55">
                <span>Em atendimento</span>
                <span className="font-semibold text-emerald-300">12</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" />
              </div>
            </div>
          </aside>

          <div className="grid grid-cols-[132px_minmax(0,1fr)] sm:grid-cols-[170px_minmax(0,1fr)]">
            <div className="border-r border-white/[0.06] bg-[#0b0e14]">
              <div className="border-b border-white/[0.06] p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-white/85">Conversas</p>
                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-medium text-emerald-300">
                    12 abertas
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[8.5px] text-white/30">
                  <Search className="size-2.5" aria-hidden="true" />
                  Buscar contato
                </div>
              </div>

              <div className="divide-y divide-white/[0.04]">
                {conversations.map((conversation, index) => (
                  <div
                    key={conversation.name}
                    className={
                      index === 0
                        ? 'bg-white/[0.045] px-2.5 py-2.5 ring-1 ring-inset ring-emerald-400/10'
                        : 'px-2.5 py-2.5'
                    }
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-[8px] font-semibold ${conversation.tone}`}
                        aria-hidden="true"
                      >
                        {conversation.initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="truncate text-[9px] font-medium text-white/80">
                            {conversation.name}
                          </p>
                          <span className="shrink-0 text-[7.5px] text-white/30">
                            {conversation.time}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[8px] leading-snug text-white/35">
                          {conversation.message}
                        </p>
                      </div>
                      {conversation.unread ? (
                        <span className="mt-2 grid size-3.5 shrink-0 place-items-center rounded-full bg-emerald-400 text-[7px] font-bold text-emerald-950">
                          {conversation.unread}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-col bg-[#0e1118]">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-emerald-500/15 text-[9px] font-semibold text-emerald-300">
                    MC
                  </span>
                  <div>
                    <p className="text-[9.5px] font-medium text-white/85">Mariana Costa</p>
                    <p className="flex items-center gap-1 text-[7.5px] text-emerald-300/80">
                      <span className="size-1 rounded-full bg-emerald-400" aria-hidden="true" />
                      WhatsApp conectado
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-emerald-400/15 bg-emerald-500/[0.08] px-2 py-0.5 text-[7.5px] text-emerald-300">
                  Em atendimento
                </span>
              </div>

              <div className="flex-1 space-y-2.5 bg-[#0b0f15] p-3">
                <div className="mx-auto w-fit rounded-full bg-white/[0.05] px-2 py-0.5 text-[7.5px] text-white/35">
                  Hoje
                </div>

                <div className="max-w-[86%] rounded-lg rounded-tl-sm border border-white/[0.06] bg-white/[0.045] px-2.5 py-1.5 text-[8.5px] leading-relaxed text-white/65">
                  Olá! Vi o anúncio de vocês e queria entender como funciona o atendimento.
                  <span className="mt-1 block text-right text-[7px] text-white/30">09:36</span>
                </div>

                <div className="ml-auto max-w-[88%] rounded-lg rounded-tr-sm bg-emerald-500/15 px-2.5 py-1.5 text-[8.5px] leading-relaxed text-emerald-50 ring-1 ring-inset ring-emerald-400/10">
                  Oi, Mariana! O OrderUp centraliza as conversas do seu time em um só lugar. Posso
                  te enviar uma proposta com os detalhes.
                  <span className="mt-1 flex items-center justify-end gap-1 text-[7px] text-emerald-200/60">
                    09:38
                    <CheckCheck className="size-2.5" aria-hidden="true" />
                  </span>
                </div>

                <div className="max-w-[86%] rounded-lg rounded-tl-sm border border-white/[0.06] bg-white/[0.045] px-2.5 py-1.5 text-[8.5px] leading-relaxed text-white/65">
                  Perfeito! Pode enviar a proposta por aqui?
                  <span className="mt-1 block text-right text-[7px] text-white/30">09:42</span>
                </div>

                <div className="ml-auto flex max-w-[88%] items-center gap-2 rounded-lg border border-emerald-400/15 bg-emerald-500/[0.08] px-2.5 py-1.5 text-[8px] text-emerald-200/80">
                  <Paperclip className="size-2.5" aria-hidden="true" />
                  proposta-orderup-crm.pdf
                </div>
              </div>

              <div className="border-t border-white/[0.06] p-2.5">
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2 text-[8.5px] text-white/30">
                  <span className="flex-1">Escreva uma mensagem...</span>
                  <Smile className="size-3" aria-hidden="true" />
                  <Send className="size-3 text-emerald-300" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-float absolute -bottom-5 left-3 hidden items-center gap-2.5 rounded-xl border border-emerald-400/15 bg-[#121722]/95 px-3.5 py-2.5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)] backdrop-blur sm:flex">
        <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300">
          <CheckCheck className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10px] font-medium text-white/85">Conversa atualizada</p>
          <p className="text-[8.5px] text-white/40">Histórico centralizado para o time</p>
        </div>
      </div>

      <div className="landing-float-slow absolute -right-4 top-16 hidden rounded-xl border border-white/[0.08] bg-[#121722]/95 px-3 py-2.5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)] backdrop-blur xl:block">
        <p className="text-[8px] uppercase tracking-[0.16em] text-white/35">Fila organizada</p>
        <p className="mt-1 text-[11px] font-semibold text-white/85">3 números conectados</p>
      </div>
    </div>
  );
}
