import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
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
  messageSnippet,
  quotedAuthorLabel,
  readMessageContacts,
  readQuotedMessage,
} from './attendance-utils';
import { LinkifiedText } from './linkified-text';
import { MessageContact } from './message-contact';
import { isMediaMessage } from './media-message-utils';
import { MessageMedia } from './message-media';
import { SenderAvatar } from './sender-avatar';

interface MessageBubbleProps {
  conversationId: string;
  message: ConversationMessage;
  isGroup: boolean;
  whatsappInstanceId: string;
  onReply?: (message: ConversationMessage) => void;
}

export function MessageBubble({
  conversationId,
  message,
  isGroup,
  whatsappInstanceId,
  onReply,
}: MessageBubbleProps) {
  const isOutbound = message.direction === 'OUTBOUND';
  const showSender = isGroup && !isOutbound;
  const isSticker = message.type === 'STICKER';
  const isMedia = isMediaMessage(message);
  const quoted = readQuotedMessage(message);
  const contacts = message.type === 'CONTACT' ? readMessageContacts(message.metadata) : [];

  if (isSticker) {
    return (
      <div className={cn('group flex items-center gap-1', isOutbound ? 'justify-end' : 'justify-start')}>
        <div className="flex max-w-[50%] flex-col items-start gap-0.5">
          {showSender && message.senderName ? (
            <span className="px-1 text-[11px] font-semibold text-primary">
              {message.senderName}
            </span>
          ) : null}
          {quoted ? <QuoteBlock quoted={quoted} isOutbound={isOutbound} /> : null}
          <MessageMedia conversationId={conversationId} message={message} />
          <span className="px-1 text-[10px] text-muted-foreground">
            {formatBubbleTime(message.occurredAt)}
          </span>
        </div>
        {onReply ? <ReplyButton onClick={() => onReply(message)} /> : null}
      </div>
    );
  }

  if (message.type === 'REACTION') {
    return (
      <div
        className={cn('group flex items-center gap-1', isOutbound ? 'justify-end' : 'justify-start')}
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
        {onReply ? <ReplyButton onClick={() => onReply(message)} /> : null}
      </div>
    );
  }

  return (
    <div className={cn('group flex items-center gap-1', isOutbound ? 'justify-end' : 'justify-start')}>
      {showSender ? (
        <SenderAvatar
          conversationId={conversationId}
          jid={message.senderId}
          name={message.senderName}
        />
      ) : null}
      <div
        className={cn(
          'flex max-w-[85%] flex-col sm:max-w-[70%]',
          isOutbound ? 'items-end' : 'items-start',
        )}
      >
        {showSender && message.senderName ? (
          <span className="mb-0.5 px-1 text-[11px] font-semibold text-primary">
            {message.senderName}
          </span>
        ) : null}
        <div
          className={cn(
            'rounded-lg text-sm shadow-sm',
            isMedia ? 'overflow-hidden p-1' : 'px-2.5 py-1.5',
            isOutbound
              ? 'rounded-br-sm bg-primary-light text-foreground'
              : 'rounded-bl-sm border border-border bg-card text-foreground',
          )}
        >
          {!isMedia && quoted ? <QuoteBlock quoted={quoted} isOutbound={isOutbound} /> : null}
          {isOutbound && message.metadata?.showAgentName === true && message.senderName ? (
            <span className="mb-0.5 block px-0.5 text-[11px] font-semibold text-primary">
              {message.senderName}
            </span>
          ) : null}
          {isMedia ? (
            <>
              {quoted ? (
                <div className="px-1 pt-1">
                  <QuoteBlock quoted={quoted} isOutbound={isOutbound} />
                </div>
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
              'flex items-center justify-end gap-1 text-[10px]',
              isMedia && !message.content ? 'px-1 pt-0.5' : 'mt-0.5 px-0.5',
            )}
          >
            {message.metadata?.viewOnce === true ? (
              <span className="mr-auto italic opacity-70">Visualização única</span>
            ) : null}
            <span
              className={cn(
                isOutbound ? 'text-foreground/60' : 'text-muted-foreground',
              )}
            >
              {formatBubbleTime(message.occurredAt)}
            </span>
            {isOutbound ? <DeliveryTicks status={message.status} /> : null}
          </div>
        </div>
      </div>
      {onReply ? <ReplyButton onClick={() => onReply(message)} /> : null}
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

function QuoteBlock({ quoted, isOutbound }: { quoted: QuotedMessage; isOutbound: boolean }) {
  const hasMediaIcon = quoted.type !== 'TEXT' && quoted.type !== 'UNKNOWN';

  return (
    <div
      className={cn(
        'mb-1 flex flex-col rounded-md border-l-4 px-2 py-1 text-left',
        quotedColorClass(quoted),
        isOutbound ? 'bg-black/10' : 'bg-surface',
      )}
    >
      <span className="text-[11px] font-semibold leading-tight">
        {quotedAuthorLabel(quoted)}
      </span>
      <span className="flex items-center gap-1">
        {hasMediaIcon ? <QuotedTypeIcon type={quoted.type} /> : null}
        <span className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
          {messageSnippet(quoted.content, quoted.type)}
        </span>
      </span>
    </div>
  );
}

function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 rounded-full text-foreground/60 transition-colors hover:bg-surface-hover hover:text-foreground"
      onClick={onClick}
      aria-label="Responder"
    >
      <Reply className="size-4" />
    </Button>
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
