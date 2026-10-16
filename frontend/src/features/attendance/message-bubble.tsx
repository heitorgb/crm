import type { MouseEvent } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  CircleDashed,
  Clock,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
  Pencil,
  Reply,
  Sticker,
  UserRound,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  ConversationMessage,
  MessageStatus,
  MessageType,
  QuotedMessage,
} from '@/types/attendance';
import {
  formatBubbleTime,
  canEditMessage,
  isMessageEdited,
  messageSnippet,
  quotedAuthorLabel,
  readMessageContacts,
  readQuotedMessage,
} from './attendance-utils';
import { LinkifiedText } from './linkified-text';
import { MessageContact } from './message-contact';
import { isMediaMessage, isViewOnceMessage } from './media-message-utils';
import { MessageMedia } from './message-media';
import { SenderAvatar } from './sender-avatar';

const VIEW_ONCE_HELP_URL = 'https://faq.whatsapp.com/';

interface MessageBubbleProps {
  conversationId: string;
  message: ConversationMessage;
  isGroup: boolean;
  whatsappInstanceId: string;
  groupedWithPrevious?: boolean;
  groupedWithNext?: boolean;
  highlighted?: boolean;
  onReply?: (message: ConversationMessage) => void;
  onEdit?: (message: ConversationMessage) => void;
  onNavigateToQuote?: (quoted: QuotedMessage) => void;
}

export function MessageBubble({
  conversationId,
  message,
  isGroup,
  whatsappInstanceId,
  groupedWithPrevious = false,
  groupedWithNext = false,
  highlighted = false,
  onReply,
  onEdit,
  onNavigateToQuote,
}: MessageBubbleProps) {
  const isOutbound = message.direction === 'OUTBOUND';
  const showSender = isGroup && !isOutbound && !groupedWithPrevious;
  const stackSpacing = groupedWithPrevious ? 'mt-0.5' : 'mt-2';
  const highlightClass = highlighted ? 'rounded-lg bg-primary/10 ring-2 ring-primary/40' : null;
  const isSticker = message.type === 'STICKER';
  const isMedia = isMediaMessage(message);
  const isViewOnce = isViewOnceMessage(message);
  const quoted = readQuotedMessage(message);
  const contacts = message.type === 'CONTACT' ? readMessageContacts(message.metadata) : [];
  const editable = canEditMessage(message);

  if (isViewOnce) {
    return (
      <div
        data-message-id={message.id}
        className={cn(
          'group flex items-start gap-1',
          stackSpacing,
          isOutbound ? 'justify-end' : 'justify-start',
          highlightClass,
        )}
      >
        {isGroup && !isOutbound ? (
          groupedWithPrevious ? (
            <span className="mt-0.5 size-7 shrink-0" aria-hidden />
          ) : (
            <SenderAvatar
              conversationId={conversationId}
              jid={message.senderId}
              name={message.senderName}
            />
          )
        ) : null}
        <div
          className={cn(
            'flex max-w-[85%] flex-col sm:max-w-[70%]',
            isOutbound ? 'items-end' : 'items-start',
          )}
        >
          {showSender && message.senderName ? (
            <span className="mb-0.5 px-3 text-[11px] font-semibold leading-tight text-primary">
              {message.senderName}
            </span>
          ) : null}
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-sm shadow-sm',
              isOutbound
                ? 'bg-primary-light text-foreground'
                : 'border border-border bg-card text-foreground',
              !groupedWithNext && (isOutbound ? 'rounded-br-sm' : 'rounded-bl-sm'),
              groupedWithPrevious && (isOutbound ? 'rounded-tr-sm' : 'rounded-tl-sm'),
            )}
          >
            <div className="flex items-start gap-2">
              <CircleDashed className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />
              <p className="text-xs italic leading-snug text-muted-foreground">
                Você recebeu uma mensagem de visualização única. Por motivos de privacidade, você só
                pode abrir essa mensagem no seu celular.{' '}
                <a
                  href={VIEW_ONCE_HELP_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium not-italic text-primary hover:underline"
                >
                  Saiba mais
                </a>
              </p>
            </div>
            <div className="mt-1 flex items-center justify-end gap-0.5 text-[10px] leading-none">
              <span
                className={cn(
                  'tabular-nums',
                  isOutbound ? 'text-foreground/55' : 'text-muted-foreground',
                )}
              >
                {formatBubbleTime(message.occurredAt)}
              </span>
              {isOutbound ? <DeliveryTicks status={message.status} /> : null}
            </div>
          </div>
        </div>
        <MessageActions
          canEdit={editable}
          onReply={onReply ? () => onReply(message) : undefined}
          onEdit={onEdit ? () => onEdit(message) : undefined}
        />
      </div>
    );
  }

  if (isSticker) {
    return (
      <div
        data-message-id={message.id}
        className={cn(
          'group flex items-center gap-1',
          stackSpacing,
          isOutbound ? 'justify-end' : 'justify-start',
          highlightClass,
        )}
      >
        <div className="flex max-w-[50%] flex-col items-start gap-0.5">
          {showSender && message.senderName ? (
            <span className="px-1 text-[11px] font-semibold text-primary">
              {message.senderName}
            </span>
          ) : null}
          {quoted ? (
            <QuoteBlock quoted={quoted} isOutbound={isOutbound} onNavigate={onNavigateToQuote} />
          ) : null}
          <MessageMedia conversationId={conversationId} message={message} />
          <span className="px-1 text-[10px] text-muted-foreground">
            {formatBubbleTime(message.occurredAt)}
          </span>
        </div>
        <MessageActions
          canEdit={editable}
          onReply={onReply ? () => onReply(message) : undefined}
          onEdit={onEdit ? () => onEdit(message) : undefined}
        />
      </div>
    );
  }

  if (message.type === 'REACTION') {
    return (
      <div
        data-message-id={message.id}
        className={cn(
          'group flex items-center gap-1',
          stackSpacing,
          isOutbound ? 'justify-end' : 'justify-start',
          highlightClass,
        )}
      >
        <div
          className={cn(
            'flex max-w-[85%] items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs shadow-sm',
            isOutbound ? 'ml-auto' : 'mr-auto',
          )}
        >
          {!isOutbound && message.senderName ? (
            <span className="font-semibold text-primary">{message.senderName}</span>
          ) : null}
          <span className="text-base leading-none" aria-label="Reação">
            {message.content ?? '👍'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatBubbleTime(message.occurredAt)}
          </span>
        </div>
        <MessageActions
          canEdit={editable}
          onReply={onReply ? () => onReply(message) : undefined}
          onEdit={onEdit ? () => onEdit(message) : undefined}
        />
      </div>
    );
  }

  return (
    <div
      data-message-id={message.id}
      className={cn(
        'group flex items-start gap-1',
        stackSpacing,
        isOutbound ? 'justify-end' : 'justify-start',
        highlightClass,
      )}
    >
      {isGroup && !isOutbound ? (
        groupedWithPrevious ? (
          <span className="mt-0.5 size-7 shrink-0" aria-hidden />
        ) : (
          <SenderAvatar
            conversationId={conversationId}
            jid={message.senderId}
            name={message.senderName}
          />
        )
      ) : null}
      <div
        className={cn(
          'flex max-w-[85%] flex-col sm:max-w-[70%]',
          isOutbound ? 'items-end' : 'items-start',
        )}
      >
        {showSender && message.senderName ? (
          <span
            className={cn(
              'mb-0.5 text-[11px] font-semibold leading-tight text-primary',
              isMedia ? 'px-1' : 'px-3',
            )}
          >
            {message.senderName}
          </span>
        ) : null}
        <div
          className={cn(
            'rounded-lg text-sm shadow-sm',
            isMedia ? 'overflow-hidden p-1' : 'px-3 py-1.5',
            isOutbound
              ? 'bg-primary-light text-foreground'
              : 'border border-border bg-card text-foreground',
            !groupedWithNext && (isOutbound ? 'rounded-br-sm' : 'rounded-bl-sm'),
            groupedWithPrevious && (isOutbound ? 'rounded-tr-sm' : 'rounded-tl-sm'),
          )}
        >
          {!isMedia && quoted ? (
            <QuoteBlock quoted={quoted} isOutbound={isOutbound} onNavigate={onNavigateToQuote} />
          ) : null}
          {isOutbound && message.metadata?.showAgentName === true && message.senderName ? (
            <span className="mb-0.5 block px-0.5 text-[11px] font-semibold text-primary">
              {message.senderName}
            </span>
          ) : null}
          {isMedia ? (
            <>
              {quoted ? (
                <QuoteBlock
                  quoted={quoted}
                  isOutbound={isOutbound}
                  onNavigate={onNavigateToQuote}
                />
              ) : null}
              <MessageMedia conversationId={conversationId} message={message} />
            </>
          ) : contacts.length > 0 ? (
            <MessageContact contacts={contacts} whatsappInstanceId={whatsappInstanceId} />
          ) : (
            <LinkifiedText
              text={message.content ?? `[${message.type.toLowerCase()}]`}
              className="whitespace-pre-wrap break-words"
            />
          )}
          {isMedia && message.content ? (
            <LinkifiedText
              text={message.content}
              className="whitespace-pre-wrap break-words px-1.5 pt-1"
            />
          ) : null}
          <div
            className={cn(
              'flex items-center justify-end gap-0.5 text-[10px] leading-none',
              isMedia && !message.content ? 'px-1 pt-0.5' : 'mt-0.5 px-0.5',
            )}
          >
            {isMessageEdited(message) ? (
              <span className="mr-0.5 italic text-muted-foreground/80">editada</span>
            ) : null}
            <span
              className={cn(
                'tabular-nums',
                isOutbound ? 'text-foreground/55' : 'text-muted-foreground',
              )}
            >
              {formatBubbleTime(message.occurredAt)}
            </span>
            {isOutbound ? <DeliveryTicks status={message.status} /> : null}
          </div>
        </div>
      </div>
      <MessageActions
        canEdit={editable}
        onReply={onReply ? () => onReply(message) : undefined}
        onEdit={onEdit ? () => onEdit(message) : undefined}
      />
    </div>
  );
}

const QUOTED_COLOR_CLASSES = [
  'border-sky-400 text-sky-500 dark:text-sky-400',
  'border-emerald-400 text-emerald-600 dark:text-emerald-400',
  'border-amber-400 text-amber-600 dark:text-amber-400',
  'border-rose-400 text-rose-500 dark:text-rose-400',
  'border-violet-400 text-violet-500 dark:text-violet-400',
  'border-teal-400 text-teal-600 dark:text-teal-400',
];

function quotedColorClass(quoted: QuotedMessage): string {
  if (quoted.fromMe) {
    return 'border-primary text-primary';
  }
  const key = quoted.authorJid ?? quoted.authorName ?? '';
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return QUOTED_COLOR_CLASSES[hash % QUOTED_COLOR_CLASSES.length];
}

function QuotedTypeIcon({ type }: { type: MessageType }) {
  const className = 'size-3.5 shrink-0';
  switch (type) {
    case 'AUDIO':
      return <Mic className={className} />;
    case 'IMAGE':
      return <ImageIcon className={className} />;
    case 'VIDEO':
      return <Video className={className} />;
    case 'DOCUMENT':
      return <FileText className={className} />;
    case 'STICKER':
      return <Sticker className={className} />;
    case 'LOCATION':
      return <MapPin className={className} />;
    case 'CONTACT':
      return <UserRound className={className} />;
    default:
      return null;
  }
}

interface QuoteBlockProps {
  quoted: QuotedMessage;
  isOutbound: boolean;
  onNavigate?: (quoted: QuotedMessage) => void;
}

function QuoteBlock({ quoted, isOutbound, onNavigate }: QuoteBlockProps) {
  const hasMediaIcon = quoted.type !== 'TEXT' && quoted.type !== 'UNKNOWN';
  const className = cn(
    'mb-1 flex flex-col rounded-md border-l-4 px-2 py-1 text-left',
    quotedColorClass(quoted),
    isOutbound ? 'bg-black/10' : 'bg-surface',
    onNavigate ? 'cursor-pointer transition-[filter] hover:brightness-95' : null,
  );
  const content = (
    <>
      <span className="text-[11px] font-semibold leading-tight">{quotedAuthorLabel(quoted)}</span>
      <span className="flex items-center gap-1">
        {hasMediaIcon ? <QuotedTypeIcon type={quoted.type} /> : null}
        <span className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
          {messageSnippet(quoted.content, quoted.type)}
        </span>
      </span>
    </>
  );

  if (!onNavigate) {
    return <div className={className}>{content}</div>;
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onNavigate(quoted);
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-label="Ir para a mensagem citada"
    >
      {content}
    </button>
  );
}

interface MessageActionsProps {
  canEdit: boolean;
  onReply?: () => void;
  onEdit?: () => void;
}

function MessageActions({ canEdit, onReply, onEdit }: MessageActionsProps) {
  const showEdit = canEdit && onEdit !== undefined;
  if (!onReply && !showEdit) {
    return null;
  }
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      {onReply ? (
        <Button
          variant="ghost"
          size="icon"
          className="message-reply-button size-8 shrink-0 rounded-full text-foreground/60 hover:bg-surface-hover hover:text-foreground"
          onClick={onReply}
          aria-label="Responder"
        >
          <Reply className="size-4" />
        </Button>
      ) : null}
      {showEdit ? (
        <Button
          variant="ghost"
          size="icon"
          className="message-reply-button size-8 shrink-0 rounded-full text-foreground/60 hover:bg-surface-hover hover:text-foreground"
          onClick={onEdit}
          aria-label="Editar mensagem"
        >
          <Pencil className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function DeliveryTicks({ status }: { status: MessageStatus }) {
  if (status === 'FAILED') {
    return (
      <span title="Falha no envio">
        <AlertCircle className="size-3.5 text-danger" />
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span title="Enviando" className="text-foreground/60">
        <Clock className="size-3.5" />
      </span>
    );
  }
  if (status === 'READ') {
    return (
      <span title="Lida">
        <CheckCheck className="size-3.5 text-info" />
      </span>
    );
  }
  if (status === 'DELIVERED') {
    return (
      <span title="Entregue" className="text-foreground/60">
        <CheckCheck className="size-3.5" />
      </span>
    );
  }
  return (
    <span title="Enviada" className="text-foreground/60">
      <Check className="size-3.5" />
    </span>
  );
}
