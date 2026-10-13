import { Link } from 'react-router-dom';
import { MessageSquare, MoreVertical, Pin, PinOff, Smartphone } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/stores/notification-store';
import type { Conversation, ConversationStatus, WhatsAppInstance } from '@/types/attendance';
import {
  conversationLabel,
  conversationPreview,
  conversationStatusLabel,
  conversationStatusTone,
  formatListTime,
} from './attendance-utils';
import { SenderAvatar } from './sender-avatar';

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  status: ConversationStatus | 'ALL';
  onStatusChange: (value: ConversationStatus | 'ALL') => void;
  instanceId: string;
  onInstanceChange: (value: string) => void;
  instances: WhatsAppInstance[];
  onTogglePin: (conversation: Conversation) => void;
  pinPendingId: string | null;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  isPending,
  isError,
  onRetry,
  search,
  onSearchChange,
  status,
  onStatusChange,
  instanceId,
  onInstanceChange,
  instances,
  onTogglePin,
  pinPendingId,
}: ConversationListProps) {
  const unreadCounts = useNotificationStore((state) => state.unreadCounts);

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Conversas</h2>
        <span className="ml-auto text-xs text-muted-foreground">{conversations.length}</span>
      </div>

      <div className="space-y-2 border-b border-border p-3">
        <SearchInput value={search} onChange={onSearchChange} placeholder="Buscar conversa" />
        <div className="flex gap-2">
          <Select value={instanceId} onValueChange={onInstanceChange}>
            <SelectTrigger aria-label="Filtrar por WhatsApp" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os WhatsApps</SelectItem>
              {instances.map((instance) => (
                <SelectItem key={instance.id} value={instance.id}>
                  {instance.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => onStatusChange(value as ConversationStatus | 'ALL')}
          >
            <SelectTrigger aria-label="Filtrar por status" className="w-[45%]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas</SelectItem>
              <SelectItem value="OPEN">Abertas</SelectItem>
              <SelectItem value="CLOSED">Encerradas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isPending ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-danger">Não foi possível carregar as conversas.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Tentar novamente
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={MessageSquare}
              title="Nenhuma conversa"
              description="As conversas aparecem aqui quando o WhatsApp receber mensagens."
              action={
                <Button variant="outline" asChild>
                  <Link to="/atendimento/whatsapp">
                    <Smartphone />
                    Conectar WhatsApp
                  </Link>
                </Button>
              }
            />
          </div>
        ) : (
          conversations.map((item) => {
            const active = item.id === activeId;
            const unread = unreadCounts[item.id] ?? 0;
            const pinPending = pinPendingId === item.id;
            return (
              <div
                key={item.id}
                className="group relative border-b border-border/70"
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'flex w-full gap-3 px-3 py-3 text-left transition-colors',
                    active ? 'bg-primary/10' : 'hover:bg-surface-hover',
                  )}
                >
                  <SenderAvatar
                    conversationId={item.id}
                    jid={item.isGroup ? null : item.externalContactId}
                    name={conversationLabel(item)}
                    src={item.avatarUrl}
                    className="size-12"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {conversationLabel(item)}
                        </span>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {conversationPreview(item)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {item.isPinned ? (
                            <Pin
                              className="size-3.5 shrink-0 text-primary"
                              aria-label="Conversa fixada"
                            />
                          ) : null}
                          {item.lastMessageAt ? formatListTime(item.lastMessageAt) : ''}
                        </span>
                        {unread > 0 ? (
                          <span
                            className="inline-flex min-w-5 items-center justify-center rounded-full bg-success px-1.5 py-0.5 text-[11px] font-semibold leading-none text-success-foreground"
                            aria-label={`${unread} mensagem${unread > 1 ? 's' : ''} não lida${unread > 1 ? 's' : ''}`}
                          >
                            {unread > 99 ? '99+' : unread}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <StatusBadge tone={conversationStatusTone[item.status]}>
                        {conversationStatusLabel[item.status]}
                      </StatusBadge>
                      {item.isGroup ? (
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Grupo
                        </span>
                      ) : null}
                      <span className="max-w-[9rem] truncate rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {item.instanceName}
                      </span>
                    </div>
                  </div>
                </button>
                <div
                  className={cn(
                    'absolute right-2 top-2 opacity-0 transition-opacity',
                    'pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100',
                    'focus-within:pointer-events-auto focus-within:opacity-100',
                  )}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 bg-card/90 text-muted-foreground"
                        disabled={pinPending}
                        aria-label="Ações da conversa"
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => onTogglePin(item)}
                        disabled={pinPending}
                      >
                        {item.isPinned ? <PinOff /> : <Pin />}
                        {item.isPinned ? 'Desafixar' : 'Fixar'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
