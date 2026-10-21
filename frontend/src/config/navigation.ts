import {
  Bell,
  Building2,
  CalendarClock,
  Contact,
  Headset,
  KanbanSquare,
  Menu,
  MessagesSquare,
  Palette,
  Receipt,
  Settings,
  Settings2,
  Shield,
  Smartphone,
  Tags,
  Users,
  Wallet,
  Webhook,
  Wrench,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MODULE_KEYS } from '@/types/modules';

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
  platformAdminOnly?: boolean;
  moduleKey?: string;
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
    title: 'CRM',
    icon: KanbanSquare,
    items: [
      { title: 'Oportunidades', to: '/leads', icon: KanbanSquare, moduleKey: MODULE_KEYS.CRM },
      { title: 'Etiquetas', to: '/crm/etiquetas', icon: Tags, moduleKey: MODULE_KEYS.CRM },
    ],
  },
  {
    title: 'Atendimento',
    icon: Headset,
    items: [
      {
        title: 'Conversas',
        to: '/atendimento/conversas',
        icon: MessagesSquare,
        moduleKey: MODULE_KEYS.ATTENDANCE,
      },
    ],
  },
  {
    title: 'Ferramentas',
    icon: Wrench,
    items: [
      {
        title: 'Respostas rápidas',
        to: '/respostas-rapidas',
        icon: Zap,
        moduleKey: MODULE_KEYS.ATTENDANCE,
      },
      {
        title: 'Mensagens agendadas',
        to: '/mensagens-agendadas',
        icon: CalendarClock,
        moduleKey: MODULE_KEYS.ATTENDANCE,
      },
    ],
  },
  {
    title: 'Contatos',
    icon: Users,
    items: [{ title: 'Contatos', to: '/contatos', icon: Contact, moduleKey: MODULE_KEYS.CONTACTS }],
  },
  {
    title: 'Financeiro',
    icon: Wallet,
    items: [
      {
        title: 'Cobranças',
        to: '/cobrancas',
        icon: Receipt,
        moduleKey: MODULE_KEYS.BILLING_CHARGES,
      },
    ],
  },
  {
    title: 'Integrações',
    icon: Webhook,
    items: [
      {
        title: 'Webhooks',
        to: '/integracoes/webhooks',
        icon: Webhook,
        moduleKey: MODULE_KEYS.WEBHOOKS,
      },
    ],
  },
  {
    title: 'Administração',
    icon: Shield,
    platformAdminOnly: true,
    items: [
      { title: 'Organizações', to: '/admin/tenants', icon: Building2 },
      { title: 'Configurações da plataforma', to: '/admin/settings', icon: Settings2 },
    ],
  },
  { title: 'Configurações', to: '/configuracoes', icon: Settings },
];

export const settingsNavigation: NavGroup = {
  title: 'Configurações',
  icon: Settings,
  items: [
    { title: 'Organização', to: '/configuracoes', icon: Building2 },
    { title: 'Equipe', to: '/configuracoes?tab=team', icon: Users },
    { title: 'Aparência', to: '/configuracoes?tab=appearance', icon: Palette },
    { title: 'Atendimento', to: '/configuracoes?tab=attendance', icon: Headset },
    { title: 'Notificações', to: '/configuracoes?tab=notifications', icon: Bell },
    { title: 'WhatsApp', to: '/configuracoes?tab=whatsapp', icon: Smartphone },
    { title: 'Menu Personalizado', to: '/configuracoes?tab=menu', icon: Menu },
  ],
};

/**
 * Builds the visible menu for a user. Entries tied to a `moduleKey` are hidden
 * when the organization has that module disabled. `enabledModules` is the
 * backend-provided list; while it is still loading (undefined) entries stay
 * visible, and the backend guard remains the source of truth for access.
 */
export function visibleNavigation(params: {
  platformAdmin: boolean;
  enabledModules?: string[];
}): NavEntry[] {
  const isVisible = (item: NavItem): boolean => {
    if (!item.moduleKey) {
      return true;
    }
    if (!params.enabledModules) {
      return true;
    }
    return params.enabledModules.includes(item.moduleKey);
  };

  return navigation
    .filter((entry) => !entry.platformAdminOnly || params.platformAdmin)
    .map((entry) =>
      isNavGroup(entry) ? { ...entry, items: entry.items.filter(isVisible) } : entry,
    )
    .filter((entry) => (isNavGroup(entry) ? entry.items.length > 0 : isVisible(entry)));
}

