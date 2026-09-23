import { Contact, Headset, MessagesSquare, Settings, Smartphone, Users } from 'lucide-react';
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
  {
    title: 'Atendimento',
    icon: Headset,
    items: [
      { title: 'Conversas', to: '/atendimento/conversas', icon: MessagesSquare },
      { title: 'WhatsApp', to: '/atendimento/whatsapp', icon: Smartphone },
    ],
  },
  {
    title: 'Contatos',
    icon: Users,
    items: [{ title: 'Contatos', to: '/contatos', icon: Contact }],
  },
  { title: 'Configurações', to: '/configuracoes', icon: Settings },
];
