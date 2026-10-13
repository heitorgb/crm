import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Mic, Paperclip, Send, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { useAttendanceStore } from '@/stores/attendance-store';
import type { ConversationMessage } from '@/types/attendance';
import { messageSnippet } from './attendance-utils';
import { EmojiPicker } from './emoji-picker';
import { MediaPreviewDialog } from './media-preview-dialog';
import { useSendConversationMedia, useSendConversationMessage } from './queries';
import { useAudioRecorder } from './use-audio-recorder';

const MAX_COMPOSER_HEIGHT = 160;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

interface MessageComposerProps {
  conversationId: string;
  replyTo: ConversationMessage | null;
  onCancelReply: () => void;
}

export function MessageComposer({ conversationId, replyTo, onCancelReply }: MessageComposerProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const pendingCaretRef = useRef<number | null>(null);

  const sendMessage = useSendConversationMessage();
  const sendMedia = useSendConversationMedia();
  const showAgentName = useAttendanceStore((state) => state.showAgentName);
  const setShowAgentName = useAttendanceStore((state) => state.setShowAgentName);
  const busy = sendMessage.isPending || sendMedia.isPending;
  const canSend = draft.trim().length > 0;

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [draft]);

  useEffect(() => {
    if (pendingCaretRef.current === null) {
      return;
    }
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    selectionRef.current = { start: caret, end: caret };
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [draft]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent): void => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item.kind !== 'file') {
          continue;
        }
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          setError(null);
          setPendingFile(file);
          return;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const handleSend = async (): Promise<void> => {
    if (!canSend || busy) {
      return;
    }
    setError(null);
    try {
      await sendMessage.mutateAsync({
        id: conversationId,
        content: draft.trim(),
        includeAgentName: showAgentName,
        quotedMessageId: replyTo?.id,
      });
      setDraft('');
      onCancelReply();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível enviar a mensagem.',
      );
    }
  };

  const handleEmojiSelect = (emoji: string): void => {
    const element = textareaRef.current;
    const focused = element !== null && document.activeElement === element;
    const selection = focused
      ? { start: element.selectionStart, end: element.selectionEnd }
      : selectionRef.current;
    const start = Math.max(0, Math.min(selection.start, draft.length));
    const end = Math.max(start, Math.min(selection.end, draft.length));
    const caret = start + emoji.length;
    selectionRef.current = { start: caret, end: caret };
    pendingCaretRef.current = caret;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
  };

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setError(null);
    setPendingFile(file);
  };

  const handlePreviewOpenChange = (open: boolean): void => {
    if (!open && !sendMedia.isPending) {
      setPendingFile(null);
      setError(null);
    }
  };

  const handlePreviewSend = async (file: File, caption: string): Promise<void> => {
    setError(null);
    try {
      await sendMedia.mutateAsync({
        id: conversationId,
        file,
        caption: caption.length > 0 ? caption : undefined,
        includeAgentName: showAgentName,
        quotedMessageId: replyTo?.id,
      });
      setDraft('');
      setPendingFile(null);
      onCancelReply();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível enviar o arquivo.');
    }
  };

  const sendRecordedAudio = async (file: File): Promise<void> => {
    setError(null);
    try {
      await sendMedia.mutateAsync({
        id: conversationId,
        file,
        includeAgentName: showAgentName,
        quotedMessageId: replyTo?.id,
      });
      onCancelReply();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível enviar o áudio.');
    }
  };

  const recorder = useAudioRecorder({
    onComplete: (file) => void sendRecordedAudio(file),
  });

  return (
    <div className="border-t border-border bg-card px-2 py-2 sm:px-3 sm:py-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,application/pdf"
        className="hidden"
        onChange={handleFileSelected}
      />
      {!pendingFile && (error || recorder.error) ? (
        <p className="mb-2 text-xs font-medium text-danger">{error ?? recorder.error}</p>
      ) : null}
      {replyTo ? (
        <div className="mb-1.5 flex items-start gap-2 rounded-md border-l-4 border-primary bg-surface px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-primary">
              {replyTo.direction === 'OUTBOUND' ? 'Você' : (replyTo.senderName ?? 'Mensagem')}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {messageSnippet(replyTo.content, replyTo.type)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onCancelReply}
            aria-label="Cancelar resposta"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
      {!recorder.recording ? (
        <label className="mb-1.5 flex w-fit cursor-pointer select-none items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={showAgentName}
            onChange={(event) => setShowAgentName(event.target.checked)}
            className="size-4 cursor-pointer rounded border-border accent-primary"
          />
          Exibir nome do atendente
        </label>
      ) : null}
      {recorder.recording ? (
        <div className="flex items-center gap-3 px-1">
          <span className="flex items-center gap-2 text-sm font-medium text-danger">
            <span className="size-2.5 animate-pulse rounded-full bg-danger" />
            Gravando {formatDuration(recorder.seconds)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => recorder.cancel()}
              aria-label="Cancelar gravação"
            >
              <Trash2 />
            </Button>
            <Button
              size="icon"
              className="rounded-full"
              onClick={() => recorder.stop()}
              disabled={busy}
              aria-label="Enviar áudio"
            >
              <Send />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-1.5 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="Anexar arquivo"
          >
            <Paperclip />
          </Button>
          <EmojiPicker onSelect={handleEmojiSelect} />
          <Textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onSelect={(event) => {
              selectionRef.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              };
            }}
            placeholder="Mensagem"
            className="max-h-40 min-h-[42px] flex-1 resize-none rounded-2xl border-border bg-surface py-2.5"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          {canSend ? (
            <Button
              size="icon"
              className="rounded-full"
              onClick={() => void handleSend()}
              disabled={busy}
              aria-label="Enviar mensagem"
            >
              <Send />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-muted-foreground"
              onClick={() => void recorder.start()}
              disabled={busy}
              aria-label="Gravar áudio"
            >
              <Mic />
            </Button>
          )}
        </div>
      )}
      <MediaPreviewDialog
        key={
          pendingFile
            ? `${pendingFile.name}-${pendingFile.size}-${pendingFile.lastModified}`
            : 'empty'
        }
        file={pendingFile}
        open={pendingFile !== null}
        sending={sendMedia.isPending}
        error={error}
        initialCaption={draft.trim()}
        onOpenChange={handlePreviewOpenChange}
        onSend={(file, caption) => void handlePreviewSend(file, caption)}
      />
    </div>
  );
}
