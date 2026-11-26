import { CircleDashed, MessagesSquare, Package, Phone } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useUnreadCount } from '@/features/attendance/queries';
import { useEnabledModules } from '@/features/modules/queries';
import { cn } from '@/lib/utils';
import { MODULE_KEYS } from '@/types/modules';

const itemClassName =
  'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const iconClassName = 'relative flex h-7 w-14 items-center justify-center rounded-full';

function ConversationUnreadBadge() {
  const unreadCount = useUnreadCount().data?.total ?? 0;

  if (unreadCount <= 0) {
    return null;
  }

  return (
    <span
      className="absolute -right-1 -top-0.5 min-w-4 rounded-full bg-success px-1 text-[10px] leading-4 text-success-foreground"
      aria-label={`${unreadCount} ${unreadCount === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`}
    >
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );
}

export function MobileBottomNavigation() {
  const { pathname, search } = useLocation();
  const enabledModules = useEnabledModules().data;
  const isAttendance = pathname === '/atendimento/conversas';
  const isDeliveries = pathname === '/entregas';

  if (
    (!isAttendance && !isDeliveries) ||
    (isAttendance && new URLSearchParams(search).has('conversation'))
  ) {
    return null;
  }

  const attendanceEnabled = !enabledModules || enabledModules.includes(MODULE_KEYS.ATTENDANCE);
  const deliveriesEnabled = !enabledModules || enabledModules.includes(MODULE_KEYS.DELIVERIES);

  return (
    <nav
      aria-label="Navegação do celular"
      className="flex shrink-0 items-center gap-1 border-t border-border bg-background px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 md:hidden"
    >
      {attendanceEnabled ? (
        <NavLink to="/atendimento/conversas" className={itemClassName}>
          {({ isActive }) => (
            <>
              <span className={cn(iconClassName, isActive && 'bg-success/20 text-success')}>
                <MessagesSquare className="size-6" aria-hidden="true" />
                <ConversationUnreadBadge />
              </span>
              <span>Conversas</span>
            </>
          )}
        </NavLink>
      ) : null}
      <button type="button" disabled className={itemClassName}>
        <span className={iconClassName}>
          <CircleDashed className="size-6" aria-hidden="true" />
        </span>
        <span>Atualizações</span>
      </button>
      {deliveriesEnabled ? (
        <NavLink to="/entregas" className={itemClassName}>
          {({ isActive }) => (
            <>
              <span className={cn(iconClassName, isActive && 'bg-success/20 text-success')}>
                <Package className="size-6" aria-hidden="true" />
              </span>
              <span>Entregas</span>
            </>
          )}
        </NavLink>
      ) : null}
      <button type="button" disabled className={itemClassName}>
        <span className={iconClassName}>
          <Phone className="size-6" aria-hidden="true" />
        </span>
        <span>Ligações</span>
      </button>
    </nav>
  );
}
