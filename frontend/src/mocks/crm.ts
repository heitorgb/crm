import type { QualificationAnalysis, QualificationLead } from '@/types/qualification';

export const dashboardMetrics = [
  { key: 'leads', label: 'Leads no período', value: '128', trend: { value: '12%', direction: 'up' as const } },
  { key: 'qualified', label: 'Qualificados', value: '42', trend: { value: '8%', direction: 'up' as const } },
  { key: 'conversations', label: 'Conversas ativas', value: '17', hint: 'em andamento agora' },
  { key: 'waiting', label: 'Aguardando resumo', value: '9', hint: 'entrega às 18:00' },
];

export const funnelStages = [
  { name: 'Novos', count: 128, tone: 'info' as const },
  { name: 'Em qualificação', count: 64, tone: 'accent' as const },
  { name: 'Qualificados', count: 42, tone: 'success' as const },
  { name: 'Repassados', count: 28, tone: 'secondary' as const },
];

export const recentLeads: QualificationLead[] = [
  {
    id: '1',
    name: 'Mariana Alves',
    company: 'Studio Nova',
    phone: '+55 11 98888-1201',
    status: 'QUALIFIED',
    score: 86,
    level: 'high',
    updatedAt: new Date(Date.now() - 12 * 60000).toISOString(),
  },
  {
    id: '2',
    name: 'Rafael Moreira',
    company: 'Oficina RPM',
    phone: '+55 21 97777-3320',
    status: 'WAITING_DIGEST',
    score: 74,
    level: 'medium',
    updatedAt: new Date(Date.now() - 35 * 60000).toISOString(),
  },
  {
    id: '3',
    name: 'Cliente Bomfim',
    company: 'Bomfim Consultoria',
    phone: '+55 31 96666-8890',
    status: 'NEEDS_HUMAN',
    score: 61,
    level: 'medium',
    updatedAt: new Date(Date.now() - 48 * 60000).toISOString(),
  },
  {
    id: '4',
    name: 'Renata Souza',
    company: 'Loja da Renata',
    phone: '+55 41 95555-4412',
    status: 'BOT_QUALIFYING',
    score: null,
    level: null,
    updatedAt: new Date(Date.now() - 3 * 60000).toISOString(),
  },
  {
    id: '5',
    name: 'Diego Martins',
    company: 'DM Autopeças',
    phone: '+55 51 94444-7781',
    status: 'DISQUALIFIED',
    score: 28,
    level: 'low',
    updatedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
  },
  {
    id: '6',
    name: 'Paula Nogueira',
    company: 'Nogueira Imóveis',
    phone: '+55 11 93333-2109',
    status: 'HANDED_OFF',
    score: 81,
    level: 'high',
    updatedAt: new Date(Date.now() - 26 * 3600000).toISOString(),
  },
];

export const latestAnalysis: QualificationAnalysis = {
  id: 'analysis-1',
  leadName: 'Mariana Alves · Studio Nova',
  status: 'QUALIFIED',
  score: 86,
  level: 'high',
  summary:
    'Lead com alta intenção de compra, orçamento definido e urgência declarada para iniciar nas próximas semanas. Perfil de decisor.',
  collectedData: [
    { label: 'Segmento', value: 'Design de interiores' },
    { label: 'Tamanho', value: '8 pessoas' },
    { label: 'Orçamento', value: 'R$ 15k–25k' },
    { label: 'Prazo', value: 'Até 30 dias' },
    { label: 'Decisor', value: 'Sim' },
    { label: 'Canal', value: 'WhatsApp' },
  ],
  strengths: [
    'Orçamento compatível com o ticket médio',
    'Decisor direto na conversa',
    'Dor clara: controle manual de orçamentos',
  ],
  risks: ['Comparando com outro fornecedor', 'Precisa de aprovação societária'],
  missing: ['Confirmação do volume mensal de orçamentos'],
  nextAction: 'Agendar demonstração com o responsável comercial ainda esta semana.',
  completedAt: new Date(Date.now() - 12 * 60000).toISOString(),
  model: 'openai/gpt-4o-mini',
};

export const digestLeads: QualificationLead[] = recentLeads.filter(
  (lead) => lead.score !== null && lead.status !== 'DISQUALIFIED' && lead.status !== 'BOT_QUALIFYING',
);
