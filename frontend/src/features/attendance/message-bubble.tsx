import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationMessage, MessageStatus } from '@/types/attendance';
import { formatBubbleTime } from './attendance-utils';
import { LinkifiedText } from './linkified-text';
import { isMediaMessage } from './media-message-utils';
import { MessageMedia } from './message-media';
import { SenderAvatar } from './sender-avatar';

interface MessageBubbleProps {
  conversationId: string;
  message: ConversationMessage;
  isGroup: boolean;
}

export function MessageBubble({ conversationId, message, isGroup }: MessageBubbleProps) {
  const isOutbound = message.direction === 'OUTBOUND';
  const showSender = isGroup && !isOutbound;
  const isSticker = message.type === 'STICKER';
  const isMedia = isMediaMessage(message);

  if (isSticker) {
    return (
      <div className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}>
        <div className="flex max-w-[50%] flex-col items-start gap-0.5">
          {showSender && message.senderName ? (
            <span className="px-1 text-[11px] font-semibold text-primary">
              {message.senderName}
            </span>
          ) : null}
          <MessageMedia conversationId={conversationId} message={message} />
          <span className="px-1 text-[10px] text-muted-foreground">
            {formatBubbleTime(message.occurredAt)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-2', isOutbound ? 'justify-end' : 'justify-start')}>
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
          {isOutbound && message.metadata?.showAgentName === true && message.senderName ? (
            <span className="mb-0.5 block px-0.5 text-[11px] font-semibold text-primary">
              {message.senderName}
            </span>
          ) : null}
          {isMedia ? (
            <MessageMedia conversationId={conversationId} message={message} />
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
