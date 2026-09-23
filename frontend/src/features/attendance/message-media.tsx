import { useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { apiRequestBlob } from '@/lib/api-client';
import type { ConversationMessage } from '@/types/attendance';
import { attachmentPath } from './services/attendance-service';
import { mediaErrorLabel } from './media-message-utils';
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

interface MediaProps {
  conversationId: string;
  message: ConversationMessage;
}

export function MessageMedia({ conversationId, message }: MediaProps) {
  const errorLabel = mediaErrorLabel(message.metadata);
  const attachment = message.attachments[0];

  if (errorLabel) {
    return <p className="text-xs italic opacity-80">{errorLabel}</p>;
  }

  if (!attachment) {
    return null;
  }

  switch (message.type) {
    case 'IMAGE':
      return <MessageImage conversationId={conversationId} message={message} />;
    case 'STICKER':
      return <MessageSticker conversationId={conversationId} message={message} />;
    case 'AUDIO':
      return <MessageAudio conversationId={conversationId} message={message} />;
    default:
      return <MessageFile conversationId={conversationId} message={message} />;
  }
}

function MessageImage({ conversationId, message }: MediaProps) {
  const [open, setOpen] = useState(false);
  const attachment = message.attachments[0];
  const previewVariant = attachment.hasThumbnail ? 'thumb' : 'main';

  const previewQuery = useAttachmentBlob({
    conversationId,
    messageId: message.id,
    attachmentId: attachment.id,
    variant: previewVariant,
  });
  const previewUrl = useObjectUrl(previewQuery.data);

  const fullQuery = useAttachmentBlob({
    conversationId,
    messageId: message.id,
    attachmentId: attachment.id,
    variant: 'main',
    enabled: open,
  });
  const fullUrl = useObjectUrl(fullQuery.data);

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

function MessageSticker({ conversationId, message }: MediaProps) {
  const attachment = message.attachments[0];
  const query = useAttachmentBlob({
    conversationId,
    messageId: message.id,
    attachmentId: attachment.id,
    variant: 'main',
  });
  const url = useObjectUrl(query.data);

  if (!url) {
    return <Skeleton className="size-32 rounded-md" />;
  }

  return (
    <img
      src={url}
      alt="Figurinha"
      className="h-32 w-32 object-contain drop-shadow-sm"
      draggable={false}
    />
  );
}

function MessageAudio({ conversationId, message }: MediaProps) {
  const attachment = message.attachments[0];
  const query = useAttachmentBlob({
    conversationId,
    messageId: message.id,
    attachmentId: attachment.id,
    variant: 'main',
  });
  const url = useObjectUrl(query.data);

  if (!url) {
    return <Skeleton className="h-10 w-56" />;
  }

  return (
    <audio controls src={url} className="h-10 w-56">
      <track kind="captions" />
    </audio>
  );
}

function MessageFile({ conversationId, message }: MediaProps) {
  const attachment = message.attachments[0];
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await apiRequestBlob(
        attachmentPath(conversationId, message.id, attachment.id, 'main'),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <FileText className="size-5 shrink-0" />
      <span className="max-w-[12rem] truncate text-sm">{attachment.fileName}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={() => void handleDownload()}
        disabled={downloading}
        aria-label="Baixar arquivo"
      >
        <Download />
      </Button>
    </div>
  );
}
