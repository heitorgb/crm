import {
  Contact,
  History,
  KanbanSquare,
  MessagesSquare,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

export const CONTACT_EMAIL = 'contato@orderup.com.br';
export const WHATSAPP_URL =
  'https://wa.me/5561998001384?text=Ol%C3%A1%21%20Quero%20conhecer%20os%20planos%20do%20OrderUp%20CRM.';
export const APP_URL = 'https://crm.orderup.com.br';

export const LANDING_NAVIGATION = [
  { label: 'Funcionalidades', href: '#funcionalidades' },
  { label: 'Benefícios', href: '#beneficios' },
  { label: 'Planos', href: '#planos' },
  { label: 'FAQ', href: '#faq' },
];

export interface LandingBenefit {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const LANDING_BENEFITS: LandingBenefit[] = [
  {
    icon: MessagesSquare,
    title: 'Atendimento centralizado',
    description:
      'Reúna as conversas da equipe em uma caixa de entrada única, com status e contexto sempre à mão.',
  },
  {
    icon: Smartphone,
    title: 'Múltiplos números de WhatsApp',
    description:
      'Conecte diferentes números e acompanhe cada operação sem alternar entre ferramentas.',
  },
  {
    icon: History,
    title: 'Histórico organizado',
    description:
      'Cada contato mantém conversas, arquivos e interações registrados no mesmo lugar.',
  },
  {
    icon: Contact,
    title: 'Gestão de contatos',
    description:
      'Encontre, cadastre e atualize contatos com agilidade para responder com contexto.',
  },
  {
    icon: KanbanSquare,
    title: 'Organização comercial',
    description:
      'Acompanhe oportunidades no pipeline, use etiquetas e mantenha o avanço do time visível.',
  },
  {
    icon: ShieldCheck,
    title: 'Isolamento por organização',
    description:
      'Permissões por papel e dados isolados por organização, com autenticação em cada acesso.',
  },
];

export interface LandingFaq {
  question: string;
  answer: string;
}

export const LANDING_FAQ: LandingFaq[] = [
  {
    question: 'O que é o OrderUp CRM?',
    answer:
      'O OrderUp CRM é uma plataforma para centralizar atendimento, contatos, oportunidades e a operação comercial da sua equipe. Ele reúne conversas de WhatsApp, histórico, CRM, automações e recursos de produtividade em um único ambiente.',
  },
  {
    question: 'Como funciona a contratação?',
    answer:
      'A contratação é feita diretamente com o time comercial da OrderUp. Você conhece as funcionalidades, alinha as condições para a sua operação e o time realiza o provisionamento da organização e do acesso do administrador. Não existe cadastro público independente de um plano.',
  },
  {
    question: 'Quais canais são compatíveis?',
    answer:
      'Hoje o OrderUp CRM integra o WhatsApp por meio da Evolution API, com suporte a múltiplos números. A disponibilidade de outros canais depende da evolução do produto.',
  },
  {
    question: 'Como funcionam os planos?',
    answer:
      'As condições são definidas com o time comercial de acordo com o tamanho da operação, a quantidade de números e os módulos necessários. Os valores e limites são apresentados durante a contratação, sem cobrança automática nesta página.',
  },
  {
    question: 'Como acessar minha conta?',
    answer:
      'Use o botão Entrar no topo da página. O acesso é feito com o e-mail e a senha cadastrados na sua organização. Se esquecer a senha, use o link “Esqueci minha senha” na tela de login para receber o link de recuperação.',
  },
  {
    question: 'Como funciona o atendimento e o suporte?',
    answer:
      'O atendimento comercial e o suporte são realizados pelos canais oficiais da OrderUp: e-mail contato@orderup.com.br e WhatsApp. As condições de atendimento são alinhadas durante a contratação.',
  },
];
