import { usePageMetadata } from '@/lib/page-metadata';
import { APP_URL } from './landing-content';
import { LandingBenefits } from './landing-benefits';
import { LandingCta } from './landing-cta';
import { LandingFaq } from './landing-faq';
import { LandingFeatures } from './landing-features';
import { LandingFooter } from './landing-footer';
import { LandingHeader } from './landing-header';
import { LandingHero } from './landing-hero';
import { LandingPlans } from './landing-plans';

export function LandingPage() {
  usePageMetadata({
    title: 'OrderUp CRM | Atendimento, CRM e operação em uma só plataforma',
    description:
      'Centralize seus canais de atendimento, organize as conversas da equipe e acompanhe contatos, oportunidades e a operação comercial em uma única plataforma.',
    canonical: `${APP_URL}/`,
    robots: 'index, follow',
  });

  return (
    <div className="landing-screen relative min-h-dvh overflow-x-clip">
      <div className="landing-canvas pointer-events-none fixed inset-0" aria-hidden="true" />
      <div
        className="landing-grid pointer-events-none absolute inset-x-0 top-0 h-[980px]"
        aria-hidden="true"
      />

      <a
        href="#conteudo"
        className="absolute left-4 top-4 z-50 -translate-y-24 rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition-transform focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        Pular para o conteúdo
      </a>

      <div className="relative">
        <LandingHeader />
        <main id="conteudo" tabIndex={-1} className="focus:outline-none">
          <LandingHero />
          <LandingBenefits />
          <LandingFeatures />
          <LandingPlans />
          <LandingFaq />
          <LandingCta />
        </main>
        <LandingFooter />
      </div>
    </div>
  );
}
