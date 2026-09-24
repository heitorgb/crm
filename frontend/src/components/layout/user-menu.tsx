import { ChevronDown, LogOut, Settings, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout } from '@/features/auth/queries';
import { useAuthStore } from '@/stores/auth-store';

const roleLabel: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  USER: 'Usuário',
};

export function UserMenu() {
  const session = useAuthStore((state) => state.session);
  const logout = useLogout();

  if (!session) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:pr-2.5" aria-label="Menu do usuário">
          <UserAvatar name={session.user.name} />
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block max-w-[9rem] truncate text-sm font-medium leading-tight">
              {session.user.name}
            </span>
            <span className="block text-[11px] leading-tight text-muted-foreground">
              {roleLabel[session.role] ?? session.role}
            </span>
          </span>
          <ChevronDown className="hidden text-muted-foreground sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block text-sm font-medium text-foreground">{session.user.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{session.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/configuracoes">
            <User />
            Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/configuracoes">
            <Settings />
            Configurações
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onClick={() => logout.mutate()}>
          <LogOut />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
