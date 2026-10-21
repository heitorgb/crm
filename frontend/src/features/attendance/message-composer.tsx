import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Loader2, Mic, Paperclip, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAiSettings, useFormalizeMessage } from '@/features/ai/queries';
import { useQuickReplies } from '@/features/quick-replies/queries';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAttendanceStore } from '@/stores/attendance-store';
import type { ConversationMessage } from '@/types/attendance';
import type { QuickReply } from '@/types/quick-replies';
import { messageSnippet } from './attendance-utils';
import { EmojiPicker } from './emoji-picker';
import { ComposerLinkPreview } from './link-preview-card';
import { extractPreviewUrls } from './linkify-text';
import { MediaPreviewDialog } from './media-preview-dialog';
import { useSendConversationMedia, useSendConversationMessage } from './queries';
import { QuickReplyMenu } from './quick-reply-menu';
import { useAudioRecorder } from './use-audio-recorder';

const MAX_COMPOSER_HEIGHT = 160;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function quickReplyFilterQuery(draft: string): string | null {
  const match = /^\/([^\n]*)$/.exec(draft);
  return match ? match[1].trim() : null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function filterQuickReplies(quickReplies: QuickReply[], query: string): QuickReply[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return quickReplies;
  }

  return quickReplies.filter((quickReply) =>
    normalizeText(`${quickReply.title} ${quickReply.content}`).includes(normalizedQuery),
  );
}

export interface ComposerInsertion {
  id: number;
  text: string;
}

interface MessageComposerProps {
  conversationId: string;
  replyTo: ConversationMessage | null;
  onCancelReply: () => void;
  insertion?: ComposerInsertion | null;
  onInsertionHandled?: () => void;
}

export function MessageComposer({
  conversationId,
  replyTo,
  onCancelReply,
  insertion,
  onInsertionHandled,
}: MessageComposerProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [undoText, setUndoText] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingInsertion, setPendingInsertion] = useState<string | null>(null);
  const [activeQuickReplyIndex, setActiveQuickReplyIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const pendingCaretRef = useRef<number | null>(null);
  const draftRef = useRef('');
  const handledInsertionRef = useRef<number | null>(null);

  const sendMessage = useSendConversationMessage();
  const sendMedia = useSendConversationMedia();
  const showAgentName = useAttendanceStore((state) => state.showAgentName);
  const setShowAgentName = useAttendanceStore((state) => state.setShowAgentName);
  const aiSettings = useAiSettings();
  const formalize = useFormalizeMessage();
  const aiAvailable = aiSettings.data?.available === true;
  const busy = sendMessage.isPending || sendMedia.isPending || aiBusy;
  const canSend = draft.trim().length > 0;

  const quickReplyQuery = quickReplyFilterQuery(draft);
  const quickReplyMenuOpen = quickReplyQuery !== null;
  const quickReplies = useQuickReplies(
    { perPage: 100, sort: 'title', order: 'asc' },
    { enabled: quickReplyMenuOpen },
  );
  const quickReplyItems = quickReplyMenuOpen
    ? filterQuickReplies(quickReplies.data?.data ?? [], quickReplyQuery)
    : [];
  const activeQuickReply =
    quickReplyItems.length > 0
      ? Math.min(activeQuickReplyIndex, quickReplyItems.length - 1)
      : 0;

  const candidatePreviewUrl = extractPreviewUrls(draft)[0] ?? null;
  const debouncedPreviewUrl = useDebouncedValue(candidatePreviewUrl, 400);
  const [removedPreviewUrl, setRemovedPreviewUrl] = useState<string | null>(null);
  const previewUrl =
    candidatePreviewUrl &&
    candidatePreviewUrl === debouncedPreviewUrl &&
    candidatePreviewUrl !== removedPreviewUrl
      ? candidatePreviewUrl
      : null;
  const linkPreview =
    candidatePreviewUrl === null
      ? undefined
      : removedPreviewUrl !== candidatePreviewUrl;

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [draft]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const applyInsertion = useCallback((text: string, mode: 'replace' | 'append'): void => {
    const normalized = text.trim();
    if (normalized.length === 0) {
      return;
    }

    const current = draftRef.current;
    const next =
      mode === 'append' && current.trim().length > 0
        ? `${current.trimEnd()}\n\n${normalized}`
        : normalized;
    const caret = next.length;

    selectionRef.current = { start: caret, end: caret };
    pendingCaretRef.current = caret;
    setDraft(next);
    setPendingInsertion(null);
    setError(null);
    setAiError(null);
    setUndoText(null);
    setRemovedPreviewUrl(null);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!insertion || handledInsertionRef.current === insertion.id) {
      return;
    }
    handledInsertionRef.current = insertion.id;
    onInsertionHandled?.();

    const text = insertion.text.trim();
    if (text.length === 0) {
      return;
    }
    if (draftRef.current.trim().length > 0) {
      setPendingInsertion(text);
      return;
    }
    applyInsertion(text, 'replace');
  }, [applyInsertion, insertion, onInsertionHandled]);

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
        linkPreview,
      });
      setDraft('');
      setPendingInsertion(null);
      setUndoText(null);
      setAiError(null);
      setRemovedPreviewUrl(null);
      onCancelReply();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível enviar a mensagem.',
      );
    }
  };

  const handleFormalize = async (): Promise<void> => {
    if (!canSend || busy || !aiAvailable) {
      return;
    }

    const original = draft;
    setAiError(null);
    setAiBusy(true);

    try {
      const result = await formalize.mutateAsync(original);

      if (draftRef.current !== original) {
        setAiError('O texto foi alterado durante a formalização. Tente novamente.');
        return;
      }

      const formatted = result.text.trim();
      if (formatted.length === 0) {
        setAiError('A IA retornou uma resposta vazia. Tente novamente.');
        return;
      }

      setUndoText(original);
      selectionRef.current = { start: formatted.length, end: formatted.length };
      pendingCaretRef.current = formatted.length;
      setDraft(formatted);
    } catch (caught) {
      setAiError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível formalizar a mensagem. Tente novamente.',
      );
    } finally {
      setAiBusy(false);
    }
  };

  const handleUndoFormalization = (): void => {
    if (undoText === null) {
      return;
    }

    const caret = undoText.length;
    setDraft(undoText);
    setUndoText(null);
    setAiError(null);
    selectionRef.current = { start: caret, end: caret };
    pendingCaretRef.current = caret;
    textareaRef.current?.focus();
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

  const handleQuickReplySelect = (quickReply: QuickReply): void => {
    const caret = quickReply.content.length;
    setError(null);
    setAiError(null);
    setUndoText(null);
    setRemovedPreviewUrl(null);
    setActiveQuickReplyIndex(0);
    selectionRef.current = { start: caret, end: caret };
    pendingCaretRef.current = caret;
    setDraft(quickReply.content);
    textareaRef.current?.focus();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (quickReplyMenuOpen) {
      if (event.key === 'ArrowDown' && quickReplyItems.length > 0) {
        event.preventDefault();
        setActiveQuickReplyIndex((activeQuickReply + 1) % quickReplyItems.length);
        return;
      }
      if (event.key === 'ArrowUp' && quickReplyItems.length > 0) {
        event.preventDefault();
        setActiveQuickReplyIndex(
          (activeQuickReply - 1 + quickReplyItems.length) % quickReplyItems.length,
        );
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDraft('');
        setActiveQuickReplyIndex(0);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (quickReplyItems.length > 0) {
          handleQuickReplySelect(quickReplyItems[activeQuickReply]);
        }
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
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
      setPendingInsertion(null);
      setUndoText(null);
      setAiError(null);
      setRemovedPreviewUrl(null);
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
    <div className="relative border-t border-border bg-card px-2 py-2 sm:px-3 sm:py-3">
      {quickReplyMenuOpen ? (
        <QuickReplyMenu
          items={quickReplyItems}
          activeIndex={activeQuickReply}
          loading={quickReplies.isPending}
          error={quickReplies.isError}
          onSelect={handleQuickReplySelect}
          onActiveIndexChange={setActiveQuickReplyIndex}
        />
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,application/pdf"
        className="hidden"
        onChange={handleFileSelected}
      />
      {!pendingFile && (error || recorder.error || aiError) ? (
        <p className="mb-2 text-xs font-medium text-danger">
          {error ?? recorder.error ?? aiError}
        </p>
      ) : null}
      {pendingInsertion ? (
        <div
          role="alert"
          className="mb-2 space-y-2 rounded-md border border-warning/30 bg-warning/10 p-2.5"
        >
          <p className="text-xs font-medium text-foreground">
            O compositor já tem um rascunho. Como deseja usar a sugestão?
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={() => applyInsertion(pendingInsertion, 'replace')}
            >
              Substituir rascunho
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyInsertion(pendingInsertion, 'append')}
            >
              Inserir ao final
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPendingInsertion(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
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
      {previewUrl && !recorder.recording ? (
        <div className="mb-1.5">
          <ComposerLinkPreview
            url={previewUrl}
            onRemove={() => setRemovedPreviewUrl(previewUrl)}
          />
        </div>
      ) : null}
      {!recorder.recording && undoText !== null ? (
        <div className="mb-1 flex justify-end px-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={handleUndoFormalization}
            aria-label="Desfazer reformulação"
          >
            <RotateCcw className="size-3.5" />
            Desfazer reformulação
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
        <div className="flex items-end gap-0.5 rounded-2xl border border-border bg-surface px-1 py-1 transition-colors focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/25 sm:gap-1 sm:px-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full text-muted-foreground"
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
            onChange={(event) => {
              const next = event.target.value;
              if (removedPreviewUrl && !next.includes(removedPreviewUrl)) {
                setRemovedPreviewUrl(null);
              }
              if (next.length === 0) {
                setUndoText(null);
              }
              setAiError(null);
              setActiveQuickReplyIndex(0);
              setDraft(next);
            }}
            onSelect={(event) => {
              selectionRef.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              };
            }}
            placeholder="Mensagem"
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border-0 bg-transparent px-2 py-2.5 text-sm shadow-none focus-visible:ring-0"
            onKeyDown={handleComposerKeyDown}
          />
          {canSend && aiAvailable ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 rounded-full text-primary"
                  onClick={() => void handleFormalize()}
                  disabled={busy}
                  aria-label="Formalizar mensagem com IA"
                >
                  {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Formalizar mensagem com IA</TooltipContent>
            </Tooltip>
          ) : null}
          {canSend ? (
            <Button
              size="icon"
              className="size-9 shrink-0 rounded-full"
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
              className="size-9 shrink-0 rounded-full text-muted-foreground"
              onClick={() => void recorder.start()}
              disabled={busy}
              aria-label="Gravar áudio"
            >
              <Mic />
            </Button>
          )}
        </div>
      )}
      {!recorder.recording ? (
        <p className="mt-1 h-4 px-2 text-[11px] text-muted-foreground">
          {draft.length === 0 ? 'Digite / para usar respostas rápidas.' : ''}
        </p>
      ) : null}
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
