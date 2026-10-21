import { createElement, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ExternalLink, Folder, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  isNavGroup,
  settingsNavigation,
  visibleNavigation,
  type NavEntry,
  type NavGroup,
  type NavItem,
} from '@/config/navigation';
import { menuIcon } from '@/config/menu-icons';
import { useCustomMenuNavigation } from '@/features/custom-menu/queries';
import { useEnabledModules } from '@/features/modules/queries';
import { isSafeExternalUrl } from '@/lib/external-url';
import type { CustomMenuButton, CustomMenuGroup } from '@/types/custom-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onNavigate?: () => void;
  className?: string;
  footer?: ReactNode;
  showCollapseToggle?: boolean;
  settingsAsGroup?: boolean;
}

export function Sidebar({
  collapsed,
  onNavigate,
  className,
  footer,
  showCollapseToggle = true,
  settingsAsGroup = false,
}: SidebarProps) {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const platformAdmin = useAuthStore((state) => state.platformAdmin);
  const enabledModules = useEnabledModules().data;
  const entries = visibleNavigation({ platformAdmin, enabledModules });
  const customGroups = (useCustomMenuNavigation().data ?? [])
    .map((group) => ({
      ...group,
      buttons: group.buttons.filter((button) => isSafeExternalUrl(button.url)),
    }))
    .filter((group) => group.buttons.length > 0);

  const settingsIndex = entries.findIndex(
    (entry) => !isNavGroup(entry) && entry.to === '/configuracoes',
  );
  const leadingEntries = settingsIndex >= 0 ? entries.slice(0, settingsIndex) : entries;
  const trailingEntries = settingsIndex >= 0 ? entries.slice(settingsIndex) : [];

  const renderEntry = (entry: NavEntry) =>
    isNavGroup(entry) ? (
      <SidebarGroup key={`group-${entry.id}`} group={entry} collapsed={collapsed} onNavigate={onNavigate} />
    ) : settingsAsGroup && entry.to === '/configuracoes' ? (
      <SidebarGroup
        key="group-configuracoes"
        group={settingsNavigation}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    ) : (
      <SidebarLink key={entry.to} item={entry} collapsed={collapsed} onNavigate={onNavigate} />
    );

  return (
    <div
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2.5 border-b border-sidebar-border px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        <img src="/images/logo-orderup.png" alt="OrderUp" className="size-8 shrink-0 rounded-md" />
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">OrderUp</p>
            <p className="truncate text-xs text-muted-foreground">CRM</p>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 overflow-x-hidden overflow-y-auto scrollbar-thin px-2 py-3">
        {leadingEntries.map(renderEntry)}
        {customGroups.map((group) => (
          <SidebarCustomGroup
            key={group.id}
            group={group}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
        {trailingEntries.map(renderEntry)}
      </nav>

      {footer ? <div className="border-t border-sidebar-border p-2">{footer}</div> : null}

      {showCollapseToggle ? (
        <div className="border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!collapsed}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" aria-hidden="true" />
            )}
            {!collapsed ? <span>Recolher</span> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SidebarCustomGroup({
  group,
  collapsed,
  onNavigate,
}: {
  group: CustomMenuGroup;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const groupId = `custom:${group.id}`;
  const open = useUiStore((state) => state.expandedNavGroups[groupId] ?? false);
  const setNavGroupExpanded = useUiStore((state) => state.setNavGroupExpanded);

  if (collapsed) {
    return (
      <div className="space-y-1">
        {group.buttons.map((button) => (
          <SidebarExternalLink
            key={button.id}
            button={button}
            collapsed
            onNavigate={onNavigate}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setNavGroupExpanded(groupId, !open)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        {createElement(menuIcon(group.icon, Folder), {
          className: 'size-4 shrink-0',
          'aria-hidden': true,
        })}
        <span className="min-w-0 flex-1 truncate text-left">{group.name}</span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
        />
      </button>
      {open ? (
        <div className="mt-0.5 space-y-0.5 pl-2">
          {group.buttons.map((button) => (
            <SidebarExternalLink
              key={button.id}
              button={button}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SidebarExternalLink({
  button,
  collapsed = false,
  onNavigate,
}: {
  button: CustomMenuButton;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <a
      href={button.url.trim()}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      aria-label={collapsed ? button.name : undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground',
      )}
    >
      {createElement(menuIcon(button.icon, ExternalLink), {
        className: 'size-4 shrink-0',
        'aria-hidden': true,
      })}
      {!collapsed ? <span className="min-w-0 truncate">{button.name}</span> : null}
    </a>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{button.name}</TooltipContent>
    </Tooltip>
  );
}

function SidebarGroup({
  group,
  collapsed,
  onNavigate,
}: {
  group: NavGroup;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const hasActiveChild = group.items.some((item) =>
    pathname.startsWith(item.to.split('?')[0]),
  );
  const open = useUiStore((state) => state.expandedNavGroups[group.id] ?? false);
  const setNavGroupExpanded = useUiStore((state) => state.setNavGroupExpanded);

  if (collapsed) {
    return (
      <div className="space-y-1">
        {group.items.map((item) => (
          <SidebarLink key={item.to} item={item} collapsed onNavigate={onNavigate} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setNavGroupExpanded(group.id, !open)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
          hasActiveChild ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        aria-expanded={open}
      >
        <group.icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{group.title}</span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
        />
      </button>
      {open ? (
        <div className="mt-0.5 space-y-0.5 pl-2">
          {group.items.map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SidebarLink({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { pathname, search } = useLocation();
  const isActive = isNavItemActive(item, pathname, search);

  const link = (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      aria-label={collapsed ? item.title : undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        isActive
          ? 'bg-sidebar-accent text-primary'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground',
      )}
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed ? <span className="min-w-0 truncate">{item.title}</span> : null}
    </NavLink>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

function isNavItemActive(item: NavItem, pathname: string, search: string): boolean {
  const [itemPath, itemSearch = ''] = item.to.split('?');
  if (pathname !== itemPath) {
    return false;
  }

  const desiredTab = new URLSearchParams(itemSearch).get('tab');
  if (!desiredTab && itemPath !== '/configuracoes') {
    return true;
  }

  const currentTab = new URLSearchParams(search).get('tab');
  if (desiredTab) {
    return currentTab === desiredTab;
  }

  return currentTab === null || currentTab === 'organization';
}
