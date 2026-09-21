import {
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  CalendarClock,
  Contact,
  Headset,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Settings,
  Ticket,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry;
}

export const navigation: NavEntry[] = [
  { title: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  {
    title: 'Vendas',
    icon: TrendingUp,
    items: [
      { title: 'Leads', to: '/vendas/leads', icon: Users },
      { title: 'Funil', to: '/vendas/funil', icon: KanbanSquare },
      { title: 'Negócios', to: '/vendas/negocios', icon: Briefcase },
    ],
  },
  {
    title: 'Clientes',
    icon: Building2,
    items: [
      { title: 'Clientes', to: '/clientes/clientes', icon: Users },
      { title: 'Contatos', to: '/clientes/contatos', icon: Contact },
    ],
  },
  {
    title: 'Atendimento',
    icon: Headset,
    items: [
      { title: 'Conversas', to: '/atendimento/conversas', icon: MessagesSquare },
      { title: 'Tickets', to: '/atendimento/tickets', icon: Ticket },
    ],
  },
  { title: 'Tarefas', to: '/tarefas', icon: ListChecks },
  { title: 'Relatórios', to: '/relatorios', icon: BarChart3 },
  {
    title: 'Configurações',
    icon: Settings,
    items: [
      { title: 'Bot e Qualificação', to: '/settings/qualification-bot', icon: Bot },
      { title: 'Resumo de Leads', to: '/settings/lead-digest', icon: CalendarClock },
    ],
  },
];
