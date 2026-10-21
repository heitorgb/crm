import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useSessionSync } from '@/features/auth/queries';
import { useMessageNotifications } from '@/features/notifications/use-message-notifications';
import { AttendanceMobileOptions } from '@/features/attendance/attendance-mobile-options';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { Header } from './header';
import { MainContent } from './main-content';
import { Sidebar } from './sidebar';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

export function AppLayout() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const mobileSidebarOpen = useUiStore((state) => state.mobileSidebarOpen);
  const sidebarPosition = useUiStore((state) => state.sidebarPosition);
  const setMobileSidebarOpen = useUiStore((state) => state.setMobileSidebarOpen);
  const { pathname } = useLocation();
  const isAttendance = pathname.startsWith('/atendimento/conversas');

  useSessionSync();
  useMessageNotifications();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const desktop = window.matchMedia('(min-width: 1024px)');
    const handleChange = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        setMobileSidebarOpen(false);
      }
    };

    desktop.addEventListener('change', handleChange);
    return () => desktop.removeEventListener('change', handleChange);
  }, [setMobileSidebarOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 lg:flex',
          collapsed ? 'w-20' : 'w-[248px]',
        )}
      />

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side={sidebarPosition} className="w-[248px] p-0">
          <SheetTitle className="sr-only">Navegação principal</SheetTitle>
          <Sidebar
            collapsed={false}
            onNavigate={() => setMobileSidebarOpen(false)}
            showCollapseToggle={false}
            settingsAsGroup
            footer={isAttendance ? <AttendanceMobileOptions /> : undefined}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
        <MainContent>
          <Outlet />
        </MainContent>
      </div>
    </div>
  );
}
