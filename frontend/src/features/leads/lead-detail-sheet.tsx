import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  CircleDollarSign,
  MessageSquare,
  Pencil,
  RefreshCw,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { buildTimeline } from '@/features/attendance/attendance-utils';
import { ChatPanel } from '@/features/attendance/chat-panel';
import {
  useCloseConversation,
  useConversation,
  useConversationHistoryMessages,
  useConversationMessages,
  useConversations,
  useMarkConversationRead,
  useRefreshGroup,
  useTakeoverConversation,
} from '@/features/attendance/queries';
import { StartConversationDialog } from '@/features/attendance/start-conversation-dialog';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/types/attendance';
import type { LeadCard, LeadPipeline } from '@/types/crm';

interface LeadDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadCard;
  pipeline: LeadPipeline;
  onEdit: () => void;
}

export function LeadDetailSheet({ open, onOpenChange, lead, pipeline, onEdit }: LeadDetailSheetProps) {
  const inbox = useConversations({ contactId: lead.contactId, perPage: 50, archived: false });
  const archived = useConversations({ contactId: lead.contactId, perPage: 50, archived: true });
  const conversations = useMemo(
    () => mergeConversations(inbox.data?.data ?? [], archived.data?.data ?? []),
    [archived.data?.data, inbox.data?.data],
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [historyRequestedId, setHistoryRequestedId] = useState<string | null>(null);
  const [startConversationOpen, setStartConversationOpen] = useState(false);
  const activeConversationId = selectedConversationId ?? conversations[0]?.id;
  const conversation = useConversation(activeConversationId);
  const messages = useConversationMessages(activeConversationId);
  const historyEnabled = Boolean(activeConversationId && historyRequestedId === activeConversationId);
  const history = useConversationHistoryMessages(activeConversationId, historyEnabled);
  const closeConversation = useCloseConversation();
  const reopenConversation = useTakeoverConversation();
  const refreshGroup = useRefreshGroup();
  const markRead = useMarkConversationRead();
  const lastMarkedRef = useRef<{ id: string; count: number } | null>(null);
  const stage = pipeline.stages.find((item) => item.id === lead.stageId);
  const timeline = buildTimeline(history.data?.pages, messages.data?.data ?? []);
  const totalPages = messages.data?.meta.totalPages ?? 1;
  const hasOlderMessages = history.data ? history.hasNextPage === true : totalPages > 1;
  const loadingOlderMessages = history.isFetchingNextPage || (historyEnabled && history.isPending);

  useEffect(() => {
    const current = conversation.data;
    if (!current || current.unreadCount <= 0) return;
    const last = lastMarkedRef.current;
    if (last?.id === current.id && last.count === current.unreadCount) return;
    lastMarkedRef.current = { id: current.id, count: current.unreadCount };
    markRead.mutate(current.id, { onError: () => { lastMarkedRef.current = null; } });
  }, [conversation.data, markRead]);

  const loadOlderMessages = (): void => {
    if (!activeConversationId) return;
    if (!historyEnabled) {
      setHistoryRequestedId(activeConversationId);
      return;
    }
    if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-[96vw] xl:max-w-7xl">
          <div className="border-b border-border px-4 py-3 pr-12">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="text-base">{lead.title}</SheetTitle>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: `${stage?.color ?? '#94a3b8'}20`, color: stage?.color ?? '#64748b' }}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: stage?.color ?? '#94a3b8' }} />
                {stage?.name ?? 'Etapa não encontrada'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{pipeline.name} · oportunidade de {lead.contact.name}</p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="max-h-64 overflow-y-auto border-b border-border bg-surface p-4 scrollbar-thin lg:max-h-none lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-3">
                <UserAvatar name={lead.contact.name} src={lead.contact.avatarUrl ?? undefined} className="size-11" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{lead.contact.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{lead.contact.phone ?? lead.contact.email ?? 'Sem telefone ou e-mail'}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs lg:grid-cols-1">
                <DetailItem icon={CircleDollarSign} label="Valor" value={formatCurrency(lead.valueCents)} />
                <DetailItem icon={UserRound} label="Responsável" value={lead.ownerName ?? 'Sem responsável'} />
                <DetailItem icon={CalendarClock} label="Próximo follow-up" value={lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : 'Não definido'} />
                <DetailItem icon={MessageSquare} label="Origem" value={lead.source ?? 'Não informada'} />
              </div>

              {lead.tags.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Etiquetas</p>
                  <div className="flex flex-wrap gap-1">
                    {lead.tags.map((tag) => (
                      <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]" style={{ backgroundColor: tag.color ? `${tag.color}18` : undefined }}>
                        <span className="size-2 rounded-full" style={{ backgroundColor: tag.color ?? '#94a3b8' }} />{tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 hidden lg:block">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Etapas do pipeline</p>
                <ol className="space-y-1">
                  {pipeline.stages.map((item) => {
                    const current = item.id === lead.stageId;
                    return (
                      <li key={item.id} className={cn('flex items-center gap-2 rounded-md px-2 py-2 text-xs', current ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground')}>
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color ?? '#94a3b8' }} />
                        <span className="truncate">{item.name}</span>
                        {current ? <span className="ml-auto text-[10px]">Atual</span> : null}
                      </li>
                    );
                  })}
                </ol>
              </div>

              {lead.notes ? (
                <div className="mt-5 hidden lg:block">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observações</p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{lead.notes}</p>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2 lg:flex-col">
                <Button variant="outline" size="sm" onClick={onEdit}><Pencil />Editar oportunidade</Button>
                {activeConversationId ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/atendimento/conversas?conversation=${activeConversationId}`}><MessageSquare />Abrir no atendimento</Link>
                  </Button>
                ) : null}
              </div>
            </aside>

            <section className="flex min-h-0 flex-1 flex-col">
              {conversations.length > 1 ? (
                <div className="border-b border-border bg-card px-3 py-2">
                  <Select value={activeConversationId} onValueChange={setSelectedConversationId}>
                    <SelectTrigger className="w-full sm:w-80" aria-label="Selecionar conversa"><SelectValue placeholder="Selecionar conversa" /></SelectTrigger>
                    <SelectContent>
                      {conversations.map((item) => <SelectItem key={item.id} value={item.id}>{conversationOptionLabel(item)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {inbox.isPending || archived.isPending ? (
                <div className="flex-1 space-y-3 p-6">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={index % 2 ? 'ml-auto h-12 w-1/3' : 'h-12 w-2/5'} />)}</div>
              ) : inbox.isError || archived.isError ? (
                <div className="flex flex-1 items-center justify-center p-6">
                  <EmptyState icon={MessageSquare} title="Não foi possível carregar as conversas" description="Tente novamente em alguns instantes." action={<Button variant="outline" onClick={() => { void inbox.refetch(); void archived.refetch(); }}><RefreshCw />Tentar novamente</Button>} />
                </div>
              ) : !activeConversationId ? (
                <div className="flex flex-1 items-center justify-center p-6">
                  <EmptyState icon={Smartphone} title="Nenhuma conversa vinculada" description="Este contato ainda não possui um atendimento no WhatsApp." action={<Button onClick={() => setStartConversationOpen(true)}><MessageSquare />Iniciar atendimento</Button>} />
                </div>
              ) : conversation.data ? (
                <ChatPanel
                  key={conversation.data.id}
                  conversation={conversation.data}
                  messages={timeline}
                  messagesPending={messages.isPending}
                  messagesError={messages.isError}
                  onRetryMessages={() => void messages.refetch()}
                  hasOlderMessages={hasOlderMessages}
                  loadingOlderMessages={loadingOlderMessages}
                  onLoadOlderMessages={loadOlderMessages}
                  closePending={closeConversation.isPending}
                  onClose={() => void closeConversation.mutateAsync(conversation.data.id)}
                  reopenPending={reopenConversation.isPending}
                  onReopen={() => void reopenConversation.mutateAsync(conversation.data.id)}
                  refreshPending={refreshGroup.isPending}
                  onRefreshGroup={() => void refreshGroup.mutateAsync(conversation.data.id)}
                />
              ) : conversation.isError ? (
                <div className="flex flex-1 items-center justify-center p-6">
                  <EmptyState icon={MessageSquare} title="Não foi possível abrir a conversa" description="Tente novamente em alguns instantes." action={<Button variant="outline" onClick={() => void conversation.refetch()}><RefreshCw />Tentar novamente</Button>} />
                </div>
              ) : (
                <div className="flex-1 space-y-3 p-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-12 w-2/5" /><Skeleton className="ml-auto h-12 w-1/3" /></div>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <StartConversationDialog open={startConversationOpen} onOpenChange={setStartConversationOpen} contact={{ id: lead.contactId, name: lead.contact.name }} />
    </>
  );
}

function DetailItem({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-card p-2"><Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="truncate font-medium text-foreground">{value}</p></div></div>;
}

function mergeConversations(inbox: Conversation[], archived: Conversation[]): Conversation[] {
  const unique = new Map([...inbox, ...archived].map((item) => [item.id, item]));
  return [...unique.values()].sort((left, right) => {
    const leftTime = new Date(left.lastMessageAt ?? left.createdAt).getTime();
    const rightTime = new Date(right.lastMessageAt ?? right.createdAt).getTime();
    return rightTime - leftTime;
  });
}

function conversationOptionLabel(conversation: Conversation): string {
  const status = conversation.status === 'OPEN' ? 'Aberta' : 'Encerrada';
  const archived = conversation.isArchived ? ' · Arquivada' : '';
  return `${conversation.instanceName} · ${status}${archived}`;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
