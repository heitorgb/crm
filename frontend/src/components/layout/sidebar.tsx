import { useState, type ReactNode } from 'react';
import { NavLink, useLocation, useMatch } from 'react-router-dom';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  isNavGroup,
  visibleNavigation,
  type NavGroup,
  type NavItem,
} from '@/config/navigation';
import { useEnabledModules } from '@/features/modules/queries';
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
}

export function Sidebar({
  collapsed,
  onNavigate,
  className,
  footer,
  showCollapseToggle = true,
}: SidebarProps) {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const platformAdmin = useAuthStore((state) => state.platformAdmin);
  const enabledModules = useEnabledModules().data;
  const entries = visibleNavigation({ platformAdmin, enabledModules });

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

      <nav className="flex-1 space-y-1 overflow-y-auto scrollbar-thin px-2 py-3">
        {entries.map((entry) =>
          isNavGroup(entry) ? (
            <SidebarGroup key={entry.title} group={entry} collapsed={collapsed} onNavigate={onNavigate} />
          ) : (
            <SidebarLink key={entry.to} item={entry} collapsed={collapsed} onNavigate={onNavigate} />
          ),
        )}
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
              <PanelLeftOpen className="size-5 shrink-0" />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" />
            )}
            {!collapsed ? <span>Recolher</span> : null}
          </button>
        </div>
      ) : null}
    </div>
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
  const location = useLocation();
  const hasActiveChild = group.items.some((item) => location.pathname.startsWith(item.to));
  const [open, setOpen] = useState(true);

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
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
          hasActiveChild ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        aria-expanded={open}
      >
        <group.icon className="size-4 shrink-0" />
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
  const isActive = useMatch({ path: item.to, end: true }) !== null;

  const link = (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        isActive
          ? 'bg-sidebar-accent text-primary'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground',
      )}
    >
      <item.icon className={cn('shrink-0', collapsed ? 'size-5' : 'size-4')} />
      {!collapsed ? <span className="truncate">{item.title}</span> : null}
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
