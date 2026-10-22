import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { LANDING_NAVIGATION } from './landing-content';
import { LandingLinkButton } from './landing-link-button';

export function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useAuthStore((state) => state.session);
  const entryHref = session ? '/atendimento/conversas' : '/login';
  const entryLabel = session ? 'Abrir plataforma' : 'Entrar';

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  const closeMenu = (): void => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#080a0f]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link
          to="/"
          aria-label="OrderUp CRM — início"
          className="group flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080a0f]"
        >
          <img
            src="/images/logo-orderup.png"
            alt=""
            className="size-9 rounded-lg shadow-[0_10px_30px_-16px_rgba(0,0,0,0.95)] ring-1 ring-white/10"
          />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-white">
              OrderUp <span className="text-emerald-400">CRM</span>
            </span>
            <span className="mt-1 hidden text-[9.5px] uppercase tracking-[0.2em] text-white/40 sm:block">
              Atendimento e vendas
            </span>
          </span>
        </Link>

        <nav
          aria-label="Navegação principal"
          className="ml-auto hidden items-center gap-1 lg:flex"
        >
          {LANDING_NAVIGATION.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-[13px] font-medium text-white/65 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          <LandingLinkButton
            href={entryHref}
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
          >
            {entryLabel}
          </LandingLinkButton>

          <LandingLinkButton
            href="#planos"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Conhecer planos
            <ArrowRight aria-hidden="true" />
          </LandingLinkButton>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-navigation"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            className="grid size-10 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-white/80 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 sm:hidden"
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div
          id="landing-mobile-navigation"
          className="border-t border-white/[0.07] bg-[#0a0d13]/95 px-4 pb-5 pt-2 backdrop-blur-xl sm:hidden"
        >
          <nav aria-label="Navegação principal no celular" className="grid gap-1">
            {LANDING_NAVIGATION.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="mt-3 grid gap-2 border-t border-white/[0.07] pt-4">
            <LandingLinkButton href="#planos" onClick={closeMenu}>
              Conhecer planos
              <ArrowRight aria-hidden="true" />
            </LandingLinkButton>
            <LandingLinkButton href={entryHref} variant="secondary" onClick={closeMenu}>
              {entryLabel}
            </LandingLinkButton>
          </div>
        </div>
      ) : null}
    </header>
  );
}
