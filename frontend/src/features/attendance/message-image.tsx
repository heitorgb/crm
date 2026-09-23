import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { ConversationMessage } from '@/types/attendance';
import { useAttachmentBlob } from './queries';

function useObjectUrl(blob: Blob | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => {
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url]);

  return url;
}

interface MessageImageProps {
  conversationId: string;
  message: ConversationMessage;
}

export function MessageImage({ conversationId, message }: MessageImageProps) {
  const [open, setOpen] = useState(false);
  const attachment = message.attachments[0];

  const previewVariant = attachment?.hasThumbnail ? 'thumb' : 'main';
  const previewQuery = useAttachmentBlob({
    conversationId,
    messageId: message.id,
    attachmentId: attachment?.id ?? '',
    variant: previewVariant,
    enabled: Boolean(attachment),
  });
  const previewUrl = useObjectUrl(previewQuery.data);

  const fullQuery = useAttachmentBlob({
    conversationId,
    messageId: message.id,
    attachmentId: attachment?.id ?? '',
    variant: 'main',
    enabled: Boolean(attachment) && open,
  });
  const fullUrl = useObjectUrl(fullQuery.data);

  if (!attachment) {
    return (
      <p className="text-xs italic opacity-75">
        Imagem {message.metadata && 'mediaError' in message.metadata ? 'indisponível' : 'recebendo…'}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Abrir imagem"
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={attachment.fileName}
                className="max-h-72 w-full max-w-xs object-cover"
              />
            ) : (
              <Skeleton className="h-40 w-56" />
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl p-2">
          {fullUrl ? (
            <img
              src={fullUrl}
              alt={attachment.fileName}
              className="max-h-[80vh] w-full object-contain"
            />
          ) : (
            <Skeleton className="h-[60vh] w-full" />
          )}
        </DialogContent>
      </Dialog>
      {message.content ? <p className="whitespace-pre-wrap text-sm">{message.content}</p> : null}
    </div>
  );
}
