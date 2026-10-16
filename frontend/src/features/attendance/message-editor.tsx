import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import type { ConversationMessage } from '@/types/attendance';
import { useEditConversationMessage } from './queries';

const MAX_EDITOR_HEIGHT = 160;

interface MessageEditorProps {
  conversationId: string;
  message: ConversationMessage;
  onCancel: () => void;
  onSaved: () => void;
}

/**
 * Inline editor for an already sent message. It only mutates the original
 * message (same id, same position) and keeps the composer disabled while the
 * edit is being confirmed, preventing duplicate submissions.
 */
export function MessageEditor({ conversationId, message, onCancel, onSaved }: MessageEditorProps) {
  const [draft, setDraft] = useState(message.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editMessage = useEditConversationMessage();
  const busy = editMessage.isPending;
  const current = message.content ?? '';
  const canSave = draft.trim().length > 0 && draft.trim() !== current.trim();

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_EDITOR_HEIGHT)}px`;
  }, [draft]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
  }, []);

  const handleSave = async (): Promise<void> => {
    if (!canSave || busy) {
      return;
    }
    setError(null);
    try {
      await editMessage.mutateAsync({
        id: conversationId,
        messageId: message.id,
        content: draft.trim(),
      });
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível editar a mensagem.',
      );
    }
  };

  return (
    <div className="border-t border-border bg-card px-2 py-2 sm:px-3 sm:py-3">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold text-primary">
        <Pencil className="size-3.5" aria-hidden />
        Editar mensagem
      </div>
      {error ? <p className="mb-2 px-1 text-xs font-medium text-danger">{error}</p> : null}
      <div className="flex items-end gap-1 rounded-2xl border border-border bg-surface px-1.5 py-1 transition-colors focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/25">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Mensagem"
          className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border-0 bg-transparent px-2 py-2.5 text-sm shadow-none focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSave();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              if (!busy) {
                onCancel();
              }
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full text-muted-foreground"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancelar edição"
        >
          <X />
        </Button>
        <Button
          size="icon"
          className="size-9 shrink-0 rounded-full"
          onClick={() => void handleSave()}
          disabled={!canSave || busy}
          aria-label="Salvar edição"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check />}
        </Button>
      </div>
    </div>
  );
}
