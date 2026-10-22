import { Link } from 'react-router-dom';
import { ArrowUpRight, Mail, MessageCircle } from 'lucide-react';
import { CONTACT_EMAIL, LANDING_NAVIGATION, WHATSAPP_URL } from './landing-content';

export function LandingFooter() {
  return (
    <footer className="relative border-t border-white/[0.07] bg-[#070910]/70 px-4 pb-10 pt-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)]">
          <div>
            <Link
              to="/"
              aria-label="OrderUp CRM — início"
              className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070910]"
            >
              <img
                src="/images/logo-orderup.png"
                alt=""
                className="size-9 rounded-lg ring-1 ring-white/10"
              />
              <span className="text-[15px] font-semibold tracking-tight text-white">
                OrderUp <span className="text-emerald-400">CRM</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-[12.5px] leading-relaxed text-white/40">
              Atendimento, contatos, oportunidades e gestão da operação em uma única plataforma para
              a sua equipe.
            </p>
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">
              Produto
            </p>
            <nav aria-label="Links do produto" className="mt-4 grid gap-2.5">
              {LANDING_NAVIGATION.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="w-fit text-[12.5px] text-white/50 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">
              Acesso
            </p>
            <nav aria-label="Links de acesso" className="mt-4 grid gap-2.5">
              <Link
                to="/login"
                className="w-fit text-[12.5px] text-white/50 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              >
                Entrar
              </Link>
              <Link
                to="/esqueci-senha"
                className="w-fit text-[12.5px] text-white/50 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              >
                Esqueci minha senha
              </Link>
            </nav>
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">
              Contato
            </p>
            <div className="mt-4 grid gap-2.5">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="inline-flex w-fit items-center gap-2 text-[12.5px] text-white/50 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              >
                <Mail className="size-3.5" aria-hidden="true" />
                {CONTACT_EMAIL}
              </a>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-2 text-[12.5px] text-white/50 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              >
                <MessageCircle className="size-3.5" aria-hidden="true" />
                WhatsApp comercial
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/[0.07] pt-6 text-[11px] text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} OrderUp CRM. Todos os direitos reservados.</p>
          <p>Atendimento, CRM e operação em uma só plataforma.</p>
        </div>
      </div>
    </footer>
  );
}
