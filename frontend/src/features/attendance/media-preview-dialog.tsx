import { useEffect, useState } from 'react';
import { FileText, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes } from '@/lib/format';

type FileKind = 'image' | 'video' | 'audio' | 'file';

const KIND_LABEL: Record<FileKind, string> = {
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  file: 'documento',
};

function fileKind(mimeType: string): FileKind {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  return 'file';
}

interface MediaPreviewDialogProps {
  file: File | null;
  open: boolean;
  sending: boolean;
  error: string | null;
  initialCaption: string;
  onOpenChange: (open: boolean) => void;
  onSend: (file: File, caption: string) => void;
}

export function MediaPreviewDialog({
  file,
  open,
  sending,
  error,
  initialCaption,
  onOpenChange,
  onSend,
}: MediaPreviewDialogProps) {
  const [caption, setCaption] = useState(initialCaption);
  const [previewUrl] = useState(() => (file ? URL.createObjectURL(file) : null));

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!file) {
    return null;
  }

  const kind = fileKind(file.type);
  const supportsCaption = kind !== 'audio';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar {KIND_LABEL[kind]}</DialogTitle>
          <DialogDescription className="truncate">{file.name}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[45vh] items-center justify-center overflow-hidden rounded-md bg-slate-950/60">
          {kind === 'image' && previewUrl ? (
            <img src={previewUrl} alt={file.name} className="max-h-[45vh] w-full object-contain" />
          ) : kind === 'video' && previewUrl ? (
            <video src={previewUrl} controls className="max-h-[45vh] w-full" />
          ) : kind === 'audio' && previewUrl ? (
            <audio src={previewUrl} controls className="w-full p-4" />
          ) : (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
              <FileText className="size-8" />
              <span className="max-w-full truncate text-sm">{file.name}</span>
              <span className="text-xs">{formatBytes(file.size)}</span>
            </div>
          )}
        </div>

        {supportsCaption ? (
          <Textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Adicione uma legenda"
            className="max-h-28 min-h-[42px] resize-none"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSend(file, caption.trim());
              }
            }}
          />
        ) : null}

        {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={() => onSend(file, caption.trim())} disabled={sending}>
            <Send />
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
