import { Building2, Contact, Headset, MessagesSquare, Receipt, Settings, Shield, Users, Wallet } from 'lucide-react';
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
    title: 'Administração',
    icon: Shield,
    platformAdminOnly: true,
    items: [{ title: 'Organizações', to: '/admin/tenants', icon: Building2 }],
  },
  { title: 'Configurações', to: '/configuracoes', icon: Settings },
];

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

