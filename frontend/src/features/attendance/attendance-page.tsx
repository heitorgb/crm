import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Smartphone,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types/attendance';
import {
  useCloseConversation,
  useConversation,
  useConversationMessages,
  useConversations,
  useSendConversationMessage,
  useTakeoverConversation,
} from './queries';
import { useAttendanceRealtime } from './use-realtime';

const statusTone: Record<ConversationStatus, StatusTone> = {
  BOT_QUALIFYING: 'info',
  QUALIFIED_WAITING_DIGEST: 'success',
  DISQUALIFIED: 'danger',
  NEEDS_HUMAN: 'warning',
  HUMAN: 'accent',
  CLOSED: 'secondary',
};

const statusLabel: Record<ConversationStatus, string> = {
  BOT_QUALIFYING: 'Bot qualificando',
  QUALIFIED_WAITING_DIGEST: 'Qualificado',
  DISQUALIFIED: 'Desqualificado',
  NEEDS_HUMAN: 'Requer humano',
  HUMAN: 'Atendimento humano',
  CLOSED: 'Encerrada',
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(value));
}

export function AttendancePage() {
  useAttendanceRealtime();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ConversationStatus | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [draft, setDraft] = useState('');

  const conversationsQuery = useConversations({
    perPage: 50,
    search: search || undefined,
    status: status === 'ALL' ? undefined : status,
  });
  const conversations = conversationsQuery.data?.data ?? [];
  const activeId = selectedId ?? conversations[0]?.id ?? null;

  const conversationQuery = useConversation(activeId ?? undefined);
  const messagesQuery = useConversationMessages(activeId ?? undefined);
  const takeover = useTakeoverConversation();
  const closeConversation = useCloseConversation();
  const sendMessage = useSendConversationMessage();

  const bottomRef = useRef<HTMLDivElement>(null);
  const messageCount = messagesQuery.data?.data.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageCount, activeId]);

  const conversation = conversationQuery.data;
  const canSend = conversation?.status === 'HUMAN';

  const handleSend = async (): Promise<void> => {
    if (!activeId || draft.trim().length === 0 || !canSend) {
      return;
    }
    await sendMessage.mutateAsync({ id: activeId, content: draft.trim() });
    setDraft('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Conversas"
        description="Atendimento de WhatsApp com o bot de qualificação."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_300px]">
        <Card className="flex h-[70vh] flex-col overflow-hidden">
          <div className="space-y-3 border-b border-border p-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar conversa" />
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as ConversationStatus | 'ALL')}
            >
              <SelectTrigger aria-label="Filtrar por status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                {Object.entries(statusLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversationsQuery.isPending ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
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
              conversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'w-full border-b border-border p-3 text-left transition-colors',
                    item.id === activeId ? 'bg-primary/5' : 'hover:bg-surface-hover',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.leadName ?? item.leadPhone ?? item.externalContactId ?? 'Contato'}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {item.lastMessageAt ? formatTime(item.lastMessageAt) : ''}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.lastMessage?.content ?? 'Sem mensagens'}
                  </p>
                  <div className="pt-1">
                    <StatusBadge tone={statusTone[item.status]}>{statusLabel[item.status]}</StatusBadge>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        <Card className="flex h-[70vh] flex-col overflow-hidden">
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={MessageSquare}
                title="Selecione uma conversa"
                description="Escolha uma conversa à esquerda para ver as mensagens."
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {conversation?.leadName ?? conversation?.leadPhone ?? 'Contato'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {conversation?.instanceName ?? ''} · {conversation?.externalContactId ?? ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {conversation ? (
                    <StatusBadge tone={statusTone[conversation.status]}>
                      {statusLabel[conversation.status]}
                    </StatusBadge>
                  ) : null}
                  {conversation && conversation.status !== 'HUMAN' && conversation.status !== 'CLOSED' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void takeover.mutateAsync(conversation.id)}
                      disabled={takeover.isPending}
                    >
                      <UserCheck />
                      Assumir
                    </Button>
                  ) : null}
                  {conversation && conversation.status !== 'CLOSED' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-danger"
                      onClick={() => void closeConversation.mutateAsync(conversation.id)}
                      disabled={closeConversation.isPending}
                    >
                      <XCircle />
                      Encerrar
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="hidden xl:inline-flex"
                    onClick={() => setPanelOpen((value) => !value)}
                    aria-label="Alternar painel do cliente"
                  >
                    {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
                  </Button>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
                {messagesQuery.isPending ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-10 w-2/3" />
                    ))}
                  </div>
                ) : (
                  messagesQuery.data?.data.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex',
                        message.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm',
                          message.direction === 'OUTBOUND'
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border bg-card text-foreground',
                        )}
                      >
                        <p className="whitespace-pre-wrap">
                          {message.content ?? `[${message.type.toLowerCase()}]`}
                        </p>
                        <span
                          className={cn(
                            'mt-1 block text-[10px]',
                            message.direction === 'OUTBOUND'
                              ? 'text-primary-foreground/70'
                              : 'text-muted-foreground',
                          )}
                        >
                          {formatTime(message.occurredAt)}
                          {message.status === 'FAILED' ? ' · falha no envio' : ''}
                        </span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-border p-3">
                {canSend ? (
                  <div className="flex items-end gap-2">
                    <Textarea
                      rows={2}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Escreva uma mensagem…"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                    />
                    <Button onClick={() => void handleSend()} disabled={sendMessage.isPending}>
                      <Send />
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Assuma a conversa para responder como humano. O bot responde enquanto estiver em
                    qualificação.
                  </p>
                )}
              </div>
            </>
          )}
        </Card>

        {panelOpen ? (
          <Card className="hidden h-[70vh] flex-col overflow-y-auto p-4 xl:flex">
            <p className="text-sm font-semibold text-foreground">Cliente</p>
            {conversation ? (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Lead</p>
                  <p>{conversation.leadName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p className="font-mono text-xs">{conversation.leadPhone ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cliente vinculado</p>
                  <p>{conversation.customerName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge tone={statusTone[conversation.status]}>
                    {statusLabel[conversation.status]}
                  </StatusBadge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Instância</p>
                  <p className="text-xs">{conversation.instanceName}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Nenhuma conversa selecionada.</p>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
