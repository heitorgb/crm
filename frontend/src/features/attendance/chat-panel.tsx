import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
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

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const SCROLL_BOTTOM_THRESHOLD = 96;

function areGrouped(
  previous: ConversationMessage | undefined,
  message: ConversationMessage | undefined,
  isGroup: boolean,
): boolean {
  if (!previous || !message) {
    return false;
  }
  if (previous.direction !== message.direction) {
    return false;
  }
  if (previous.type === 'REACTION' || message.type === 'REACTION') {
    return false;
  }
  if (dayKey(previous.occurredAt) !== dayKey(message.occurredAt)) {
    return false;
  }
  if (isGroup && message.direction === 'INBOUND' && previous.senderId !== message.senderId) {
    return false;
  }
  if (message.direction === 'OUTBOUND' && previous.senderId !== message.senderId) {
    return false;
  }
  const gap = new Date(message.occurredAt).getTime() - new Date(previous.occurredAt).getTime();
  return gap >= 0 && gap <= GROUP_WINDOW_MS;
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const isGroup = conversation.isGroup;
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  useEffect(() => {
    if (!atBottomRef.current) {
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, conversation.id]);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance < SCROLL_BOTTOM_THRESHOLD;
    atBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && messages.length > 0);
  };

  const scrollToBottom = (): void => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    atBottomRef.current = true;
    setShowJumpToBottom(false);
  };

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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-wallpaper relative flex-1 overflow-y-auto scrollbar-thin px-3 py-4 sm:px-6"
      >
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
            const next = messages[index + 1];
            const showDay =
              !previous || dayKey(previous.occurredAt) !== dayKey(message.occurredAt);
            return (
              <Fragment key={message.id}>
                {showDay ? (
                  <div className="flex justify-center pb-1 pt-4">
                    <span className="rounded-md bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                      {formatDayLabel(message.occurredAt)}
                    </span>
                  </div>
                ) : null}
                <MessageBubble
                  conversationId={message.conversationId}
                  message={message}
                  isGroup={isGroup}
                  whatsappInstanceId={conversation.whatsappInstanceId}
                  groupedWithPrevious={areGrouped(previous, message, isGroup)}
                  groupedWithNext={areGrouped(message, next, isGroup)}
                  onReply={setReplyTo}
                />
              </Fragment>
            );
          })
        )}
        <div ref={bottomRef} />
        {showJumpToBottom ? (
          <div className="pointer-events-none sticky bottom-3 z-10 flex justify-end">
            <Button
              variant="outline"
              size="icon"
              className="pointer-events-auto size-9 rounded-full border-border bg-card shadow-md"
              onClick={scrollToBottom}
              aria-label="Ir para as últimas mensagens"
            >
              <ArrowDown />
            </Button>
          </div>
        ) : null}
      </div>

      <MessageComposer
        key={conversation.id}
        conversationId={conversation.id}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}
