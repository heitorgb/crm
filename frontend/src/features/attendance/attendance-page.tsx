import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Send,
  Smartphone,
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
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import {
  useCloseConversation,
  useConversation,
  useConversationMessages,
  useConversations,
  useSendConversationMedia,
  useSendConversationMessage,
} from './queries';
import { MessageImage } from './message-image';
import { useAttendanceRealtime } from './use-realtime';

const statusTone: Record<ConversationStatus, StatusTone> = {
  OPEN: 'success',
  CLOSED: 'secondary',
};

const statusLabel: Record<ConversationStatus, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Encerrada',
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(value));
}

function contactLabel(
  conversation:
    | {
        contactName: string | null;
        contactPhone: string | null;
        externalContactId: string | null;
      }
    | undefined,
): string {
  if (!conversation) {
    return 'Contato';
  }
  return (
    conversation.contactName ?? conversation.contactPhone ?? conversation.externalContactId ?? 'Contato'
  );
}

export function AttendancePage() {
  useAttendanceRealtime();

  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ConversationStatus | 'ALL'>('ALL');
  const [instanceId, setInstanceId] = useState<string>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('conversation'),
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const [draft, setDraft] = useState('');

  const instancesQuery = useWhatsAppInstances({ perPage: 100 });
  const conversationsQuery = useConversations({
    perPage: 50,
    search: search || undefined,
    status: status === 'ALL' ? undefined : status,
    whatsappInstanceId: instanceId === 'ALL' ? undefined : instanceId,
  });
  const conversations = conversationsQuery.data?.data ?? [];
  const activeId = selectedId ?? conversations[0]?.id ?? null;

  const conversationQuery = useConversation(activeId ?? undefined);
  const messagesQuery = useConversationMessages(activeId ?? undefined);
  const closeConversation = useCloseConversation();
  const sendMessage = useSendConversationMessage();
  const sendMedia = useSendConversationMedia();

  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messageCount = messagesQuery.data?.data.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageCount, activeId]);

  const conversation = conversationQuery.data;
  const canSend = Boolean(conversation);

  const handleSend = async (): Promise<void> => {
    if (!activeId || draft.trim().length === 0 || !canSend) {
      return;
    }
    await sendMessage.mutateAsync({ id: activeId, content: draft.trim() });
    setDraft('');
  };

  const handleMediaSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !activeId) {
      return;
    }
    await sendMedia.mutateAsync({
      id: activeId,
      file,
      caption: draft.trim().length > 0 ? draft.trim() : undefined,
    });
    setDraft('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Conversas"
        description="Chat centralizado de todos os WhatsApps conectados."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_300px]">
        <Card className="flex h-[70vh] flex-col overflow-hidden">
          <div className="space-y-3 border-b border-border p-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar conversa" />
            <Select
              value={instanceId}
              onValueChange={(value) => {
                setInstanceId(value);
                setSelectedId(null);
              }}
            >
              <SelectTrigger aria-label="Filtrar por WhatsApp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os WhatsApps</SelectItem>
                {instancesQuery.data?.data.map((instance) => (
                  <SelectItem key={instance.id} value={instance.id}>
                    {instance.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as ConversationStatus | 'ALL')}
            >
              <SelectTrigger aria-label="Filtrar por status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="OPEN">Abertas</SelectItem>
                <SelectItem value="CLOSED">Encerradas</SelectItem>
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
                      {contactLabel(item)}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {item.lastMessageAt ? formatTime(item.lastMessageAt) : ''}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.lastMessage?.content ?? 'Sem mensagens'}
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <StatusBadge tone={statusTone[item.status]}>
                      {statusLabel[item.status]}
                    </StatusBadge>
                    <span className="truncate rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {item.instanceName}
                    </span>
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
                    {contactLabel(conversation)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    WhatsApp: {conversation?.instanceName ?? '—'} ·{' '}
                    {conversation?.contactPhone ?? conversation?.externalContactId ?? ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {conversation ? (
                    <StatusBadge tone={statusTone[conversation.status]}>
                      {statusLabel[conversation.status]}
                    </StatusBadge>
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
                    aria-label="Alternar painel do contato"
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
                        {message.type === 'IMAGE' ? (
                          <MessageImage
                            conversationId={message.conversationId}
                            message={message}
                          />
                        ) : (
                          <p className="whitespace-pre-wrap">
                            {message.content ?? `[${message.type.toLowerCase()}]`}
                          </p>
                        )}
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
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void handleMediaSelected(event)}
                />
                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => mediaInputRef.current?.click()}
                    disabled={sendMedia.isPending}
                    aria-label="Enviar imagem"
                  >
                    <Paperclip />
                  </Button>
                  <Textarea
                    rows={2}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Escreva uma mensagem ou anexe uma imagem…"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                  <Button
                    onClick={() => void handleSend()}
                    disabled={sendMessage.isPending || sendMedia.isPending}
                  >
                    <Send />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {panelOpen ? (
          <Card className="hidden h-[70vh] flex-col overflow-y-auto p-4 xl:flex">
            <p className="text-sm font-semibold text-foreground">Contato</p>
            {conversation ? (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Nome</p>
                  <p>{conversation.contactName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p className="font-mono text-xs">
                    {conversation.contactPhone ?? conversation.externalContactId ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">WhatsApp</p>
                  <p className="text-xs">{conversation.instanceName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge tone={statusTone[conversation.status]}>
                    {statusLabel[conversation.status]}
                  </StatusBadge>
                </div>
                {conversation.contactId ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/contatos/${conversation.contactId}`}>Ver contato</Link>
                  </Button>
                ) : null}
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
