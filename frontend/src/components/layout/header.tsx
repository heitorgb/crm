import { useState } from 'react';
import { Menu } from 'lucide-react';
import { SearchInput } from '@/components/common/search-input';
import { TenantSelector, type TenantOption } from '@/components/common/tenant-selector';
import { Button } from '@/components/ui/button';
import { useSwitchTenant } from '@/features/auth/queries';
import { useAuthStore } from '@/stores/auth-store';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

interface HeaderProps {
  onOpenMobileSidebar: () => void;
}

export function Header({ onOpenMobileSidebar }: HeaderProps) {
  const [search, setSearch] = useState('');
  const session = useAuthStore((state) => state.session);
  const memberships = useAuthStore((state) => state.memberships);
  const switchTenant = useSwitchTenant();

  const tenants: TenantOption[] = memberships.length
    ? memberships.map((membership) => ({ id: membership.tenantId, name: membership.tenantName }))
    : session
      ? [{ id: session.tenant.id, name: session.tenant.name }]
      : [];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileSidebar}
        aria-label="Abrir menu"
      >
        <Menu />
      </Button>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar contatos e conversas…"
        className="hidden w-full max-w-xs md:block"
      />

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
    </header>
  );
}
