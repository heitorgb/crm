import { Camera, Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { TenantSelector, type TenantOption } from '@/components/common/tenant-selector';
import { Button } from '@/components/ui/button';
import { useSwitchTenant } from '@/features/auth/queries';
import { useAuthStore } from '@/stores/auth-store';
import { useAttendanceViewStore } from '@/stores/attendance-view-store';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

interface HeaderProps {
  onOpenMobileSidebar: () => void;
}

export function Header({ onOpenMobileSidebar }: HeaderProps) {
  const { pathname } = useLocation();
  const session = useAuthStore((state) => state.session);
  const memberships = useAuthStore((state) => state.memberships);
  const switchTenant = useSwitchTenant();
  const openPhotoComposer = useAttendanceViewStore((state) => state.openPhotoComposer);

  const isAttendance = pathname.startsWith('/atendimento/conversas');

  const tenants: TenantOption[] = memberships.length
    ? memberships.map((membership) => ({ id: membership.tenantId, name: membership.tenantName }))
    : session
      ? [{ id: session.tenant.id, name: session.tenant.name }]
      : [];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/80 bg-background/80 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-4">
      {isAttendance ? (
        <div className="flex w-full items-center gap-2 lg:hidden">
          <UserMenu />
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={openPhotoComposer}
              aria-label="Enviar foto"
            >
              <Camera />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMobileSidebar}
              aria-label="Abrir menu"
            >
              <Menu />
            </Button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'w-full items-center gap-2',
          isAttendance ? 'hidden lg:flex' : 'flex',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobileSidebar}
          aria-label="Abrir menu"
        >
          <Menu />
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          {session ? (
            <div className="hidden sm:block">
              <TenantSelector
                tenants={tenants}
                value={session.tenant.id}
                onChange={(tenantId) => switchTenant.mutate(tenantId)}
                loading={switchTenant.isPending}
              />
            </div>
          ) : null}
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
