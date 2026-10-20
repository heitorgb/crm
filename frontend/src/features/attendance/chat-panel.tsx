import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  Info,
  Loader2,
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
import type { Conversation, ConversationMessage, QuotedMessage } from '@/types/attendance';
import {
  areGrouped,
  computeMessageScrollTop,
  conversationLabel,
  conversationStatusLabel,
  conversationStatusTone,
  conversationSubtitle,
  dayKey,
  findQuotedMessage,
  formatDayLabel,
  QUOTE_HIGHLIGHT_MS,
} from './attendance-utils';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';
import { MessageEditor } from './message-editor';
import { SenderAvatar } from './sender-avatar';

const SCROLL_BOTTOM_THRESHOLD = 96;
const LOAD_OLDER_THRESHOLD = 300;

interface ChatPanelProps {
  conversation: Conversation;
  messages: ConversationMessage[];
  messagesPending: boolean;
  messagesError: boolean;
  onRetryMessages: () => void;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  onBack?: () => void;
  onToggleInfo?: () => void;
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
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
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
  const previousScrollHeightRef = useRef(0);
  const prependingRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const isGroup = conversation.isGroup;
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);
  const [editing, setEditing] = useState<ConversationMessage | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!atBottomRef.current) {
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, conversation.id]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    loadingOlderRef.current = loadingOlderMessages;
    if (!loadingOlderMessages) {
      prependingRef.current = false;
    }
  }, [loadingOlderMessages]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!prependingRef.current || !element) {
      return;
    }
    const delta = element.scrollHeight - previousScrollHeightRef.current;
    if (delta > 0) {
      element.scrollTop += delta;
    }
    prependingRef.current = false;
  }, [messages.length]);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance < SCROLL_BOTTOM_THRESHOLD;
    atBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && messages.length > 0);

    if (
      element.scrollTop <= LOAD_OLDER_THRESHOLD &&
      hasOlderMessages &&
      !loadingOlderRef.current
    ) {
      loadingOlderRef.current = true;
      prependingRef.current = true;
      previousScrollHeightRef.current = element.scrollHeight;
      onLoadOlderMessages();
    }
  };

  const scrollToBottom = (): void => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    atBottomRef.current = true;
    setShowJumpToBottom(false);
  };

  const showNotice = (text: string): void => {
    setNotice(text);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 2600);
  };

  const highlightMessage = (messageId: string): void => {
    setHighlightedId(messageId);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedId(null);
      highlightTimerRef.current = null;
    }, QUOTE_HIGHLIGHT_MS);
  };

  const handleNavigateToQuote = (quoted: QuotedMessage): void => {
    const target = findQuotedMessage(messages, conversation.id, quoted);
    const container = scrollRef.current;
    if (!target || !container) {
      showNotice('Mensagem original não disponível');
      return;
    }

    const element = container.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(target.id)}"]`,
    );
    if (!element) {
      showNotice('Mensagem original não disponível');
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const top = computeMessageScrollTop({
      containerTop: containerRect.top,
      containerHeight: container.clientHeight,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      elementTop: elementRect.top,
      elementHeight: elementRect.height,
    });

    atBottomRef.current = false;
    container.scrollTo({ top, behavior: 'smooth' });
    highlightMessage(target.id);
  };

  const handleStartReply = (message: ConversationMessage): void => {
    setEditing(null);
    setReplyTo(message);
  };

  const handleStartEdit = (message: ConversationMessage): void => {
    setReplyTo(null);
    setEditing(message);
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-card px-2 py-2 sm:px-4 sm:py-3">
        {onBack ? (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onBack}
            aria-label="Voltar para conversas"
          >
            <ArrowLeft />
          </Button>
        ) : null}
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
        {onToggleInfo ? (
          <Button variant="ghost" size="icon" onClick={onToggleInfo} aria-label="Informações">
            <Info />
          </Button>
        ) : null}
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
        className="chat-wallpaper relative min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 py-4 sm:px-6"
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
          <>
            {loadingOlderMessages ? (
              <div className="flex justify-center py-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : null}
            {messages.map((message, index) => {
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
                    highlighted={highlightedId === message.id || editing?.id === message.id}
                    onReply={handleStartReply}
                    onEdit={handleStartEdit}
                    onNavigateToQuote={handleNavigateToQuote}
                  />
                </Fragment>
              );
            })}
          </>
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

      {editing ? (
        <MessageEditor
          key={editing.id}
          conversationId={conversation.id}
          message={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : (
        <MessageComposer
          key={conversation.id}
          conversationId={conversation.id}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      )}

      {notice ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
          <span
            role="status"
            className="pointer-events-auto rounded-md bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow-md"
          >
            {notice}
          </span>
        </div>
      ) : null}
    </div>
  );
}
