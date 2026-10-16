import { Building2, Contact, Headset, MessagesSquare, Receipt, Settings, Shield, Users, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
  platformAdminOnly?: boolean;
}

export interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
  platformAdminOnly?: boolean;
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry;
}

export const navigation: NavEntry[] = [
  {
    title: 'Atendimento',
    icon: Headset,
    items: [{ title: 'Conversas', to: '/atendimento/conversas', icon: MessagesSquare }],
  },
  {
    title: 'Contatos',
    icon: Users,
    items: [{ title: 'Contatos', to: '/contatos', icon: Contact }],
  },
  {
    title: 'Financeiro',
    icon: Wallet,
    items: [{ title: 'Cobranças', to: '/cobrancas', icon: Receipt }],
  },
  {
    title: 'Administração',
    icon: Shield,
    platformAdminOnly: true,
    items: [{ title: 'Organizações', to: '/admin/tenants', icon: Building2 }],
  },
  { title: 'Configurações', to: '/configuracoes', icon: Settings },
];
