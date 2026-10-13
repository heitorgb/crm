import { Fragment, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Info,
  MessageSquare,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  UserRound,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { Conversation, ConversationMessage } from '@/types/attendance';
import {
  conversationLabel,
  conversationStatusLabel,
  conversationStatusTone,
  conversationSubtitle,
  dayKey,
  formatDayLabel,
} from './attendance-utils';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';
import { SenderAvatar } from './sender-avatar';

interface ChatPanelProps {
  conversation: Conversation;
  messages: ConversationMessage[];
  messagesPending: boolean;
  messagesError: boolean;
  onRetryMessages: () => void;
  onBack: () => void;
  onToggleInfo: () => void;
  closePending: boolean;
  onClose: () => void;
  reopenPending: boolean;
  onReopen: () => void;
  refreshPending: boolean;
  onRefreshGroup: () => void;
}

export function ChatPanel({
  conversation,
  messages,
  messagesPending,
  messagesError,
  onRetryMessages,
  onBack,
  onToggleInfo,
  closePending,
  onClose,
  reopenPending,
  onReopen,
  refreshPending,
  onRefreshGroup,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const isGroup = conversation.isGroup;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation.id]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card px-2 py-2 sm:px-4 sm:py-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label="Voltar para conversas"
        >
          <ArrowLeft />
        </Button>
        <SenderAvatar
          conversationId={conversation.id}
          jid={isGroup ? null : conversation.externalContactId}
          name={conversationLabel(conversation)}
          src={conversation.avatarUrl}
          className="size-10"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {conversationLabel(conversation)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {conversationSubtitle(conversation)}
          </p>
        </div>
        <StatusBadge
          tone={conversationStatusTone[conversation.status]}
          className="hidden sm:inline-flex"
        >
          {conversationStatusLabel[conversation.status]}
        </StatusBadge>
        <Button variant="ghost" size="icon" onClick={onToggleInfo} aria-label="Informações">
          <Info />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Mais ações">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {conversation.status === 'CLOSED' ? (
              <DropdownMenuItem onSelect={onReopen} disabled={reopenPending}>
                <RotateCcw />
                Reabrir conversa
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onClose} disabled={closePending} destructive>
                <XCircle />
                Encerrar conversa
              </DropdownMenuItem>
            )}
            {isGroup ? (
              <DropdownMenuItem onSelect={onRefreshGroup} disabled={refreshPending}>
                <RefreshCw />
                Atualizar dados do grupo
              </DropdownMenuItem>
            ) : null}
            {conversation.contactId ? (
              <DropdownMenuItem asChild>
                <Link to={`/contatos/${conversation.contactId}`}>
                  <UserRound />
                  Ver contato
                </Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="chat-wallpaper flex-1 space-y-2 overflow-y-auto scrollbar-thin px-3 py-4 sm:px-6">
        {messagesPending ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton
                key={index}
                className={index % 2 === 0 ? 'h-12 w-2/5' : 'ml-auto h-12 w-1/3'}
              />
            ))}
          </div>
        ) : messagesError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium text-danger">Não foi possível carregar as mensagens.</p>
            <Button variant="outline" size="sm" onClick={onRetryMessages}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              title="Nenhuma mensagem ainda"
              description="Envie a primeira mensagem para iniciar esta conversa."
              className="border-none bg-transparent"
            />
          </div>
        ) : (
          messages.map((message, index) => {
            const previous = messages[index - 1];
            const showDay =
              !previous || dayKey(previous.occurredAt) !== dayKey(message.occurredAt);
            return (
              <Fragment key={message.id}>
                {showDay ? (
                  <div className="flex justify-center py-2">
                    <span className="rounded-md bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                      {formatDayLabel(message.occurredAt)}
                    </span>
                  </div>
                ) : null}
                <MessageBubble
                  conversationId={message.conversationId}
                  message={message}
                  isGroup={isGroup}
                />
              </Fragment>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <MessageComposer key={conversation.id} conversationId={conversation.id} />
    </div>
  );
}
