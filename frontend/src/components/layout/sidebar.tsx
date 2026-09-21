import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { isNavGroup, navigation, type NavGroup, type NavItem } from '@/config/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onNavigate?: () => void;
  className?: string;
}

export function Sidebar({ collapsed, onNavigate, className }: SidebarProps) {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

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
        {navigation.map((entry) =>
          isNavGroup(entry) ? (
            <SidebarGroup key={entry.title} group={entry} collapsed={collapsed} onNavigate={onNavigate} />
          ) : (
            <SidebarLink key={entry.to} item={entry} collapsed={collapsed} onNavigate={onNavigate} />
          ),
        )}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
            collapsed && 'justify-center',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed ? <span>Recolher</span> : null}
        </button>
      </div>
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
        <group.icon className="size-4" />
        <span className="flex-1 text-left">{group.title}</span>
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
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
  const link = (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-sidebar-accent text-primary'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground',
        )
      }
    >
      <item.icon className="size-4 shrink-0" />
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
