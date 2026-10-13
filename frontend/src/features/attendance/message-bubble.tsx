import { AlertCircle, Check, CheckCheck, Clock, Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConversationMessage, MessageStatus, QuotedMessage } from '@/types/attendance';
import {
  formatBubbleTime,
  messageSnippet,
  quotedAuthorLabel,
  readQuotedMessage,
} from './attendance-utils';
import { LinkifiedText } from './linkified-text';
import { isMediaMessage } from './media-message-utils';
import { MessageMedia } from './message-media';
import { SenderAvatar } from './sender-avatar';

interface MessageBubbleProps {
  conversationId: string;
  message: ConversationMessage;
  isGroup: boolean;
  onReply?: (message: ConversationMessage) => void;
}

export function MessageBubble({ conversationId, message, isGroup, onReply }: MessageBubbleProps) {
  const isOutbound = message.direction === 'OUTBOUND';
  const showSender = isGroup && !isOutbound;
  const isSticker = message.type === 'STICKER';
  const isMedia = isMediaMessage(message);
  const quoted = readQuotedMessage(message);

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

function QuoteBlock({ quoted, isOutbound }: { quoted: QuotedMessage; isOutbound: boolean }) {
  return (
    <div
      className={cn(
        'mb-1 flex flex-col rounded-md border-l-4 border-primary px-2 py-1 text-left',
        isOutbound ? 'bg-black/5' : 'bg-surface',
      )}
    >
      <span className="text-[11px] font-semibold text-primary">{quotedAuthorLabel(quoted)}</span>
      <span className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
        {messageSnippet(quoted.content, quoted.type)}
      </span>
    </div>
  );
}

function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 text-muted-foreground opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
