import { Outlet } from 'react-router-dom';
import { useSessionSync } from '@/features/auth/queries';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { Header } from './header';
import { MainContent } from './main-content';
import { Sidebar } from './sidebar';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

export function AppLayout() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const mobileSidebarOpen = useUiStore((state) => state.mobileSidebarOpen);
  const setMobileSidebarOpen = useUiStore((state) => state.setMobileSidebarOpen);

  useSessionSync();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        className={cn(
          'hidden transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[68px]' : 'w-[248px]',
        )}
      />

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[248px] p-0">
          <SheetTitle className="sr-only">Navegação principal</SheetTitle>
          <Sidebar collapsed={false} onNavigate={() => setMobileSidebarOpen(false)} />
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
