import { Bell, CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  icon: LucideIcon;
  tone: 'info' | 'success' | 'warning';
}

const notifications: NotificationItem[] = [
  {
    id: '1',
    title: 'Novo lead qualificado',
    description: 'Mariana Alves atingiu score 86 no bot.',
    time: 'há 12 min',
    icon: CheckCircle2,
    tone: 'success',
  },
  {
    id: '2',
    title: 'Lead precisa de humano',
    description: 'Cliente pediu atendimento durante a qualificação.',
    time: 'há 40 min',
    icon: ShieldAlert,
    tone: 'warning',
  },
  {
    id: '3',
    title: 'Resumo diário agendado',
    description: 'Entrega de leads qualificados às 18:00.',
    time: 'há 2 h',
    icon: Sparkles,
    tone: 'info',
  },
];

const toneStyles: Record<NotificationItem['tone'], string> = {
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
};

export function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificações">
          <Bell />
          <span className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-background" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notificações</span>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {notifications.length} novas
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.map((notification) => (
          <DropdownMenuItem
            key={notification.id}
            className="items-start gap-3 py-2.5"
            onSelect={(event) => event.preventDefault()}
          >
            <span
              className={cn(
                'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                toneStyles[notification.tone],
              )}
            >
              <notification.icon className="size-4" />
            </span>
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{notification.title}</span>
              <span className="block text-xs text-muted-foreground">{notification.description}</span>
              <span className="block text-[11px] text-muted-foreground/80">{notification.time}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
