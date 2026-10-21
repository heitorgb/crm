import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import type { QuickReply } from '@/types/quick-replies';
import { useCreateQuickReply, useUpdateQuickReply } from './queries';

interface QuickReplyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quickReply?: QuickReply | null;
}

export function QuickReplyForm({ open, onOpenChange, quickReply }: QuickReplyFormProps) {
  const isEditing = Boolean(quickReply);
  const createQuickReply = useCreateQuickReply();
  const updateQuickReply = useUpdateQuickReply();

  const [title, setTitle] = useState(quickReply?.title ?? '');
  const [content, setContent] = useState(quickReply?.content ?? '');
  const [error, setError] = useState<string | null>(null);

  const pending = createQuickReply.isPending || updateQuickReply.isPending;

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (title.trim().length === 0) {
      setError('Informe um título para a resposta rápida.');
      return;
    }

    if (content.trim().length === 0) {
      setError('Escreva o conteúdo da resposta rápida.');
      return;
    }

    const payload = { title: title.trim(), content: content.trim() };

    try {
      if (quickReply) {
        await updateQuickReply.mutateAsync({ id: quickReply.id, input: payload });
      } else {
        await createQuickReply.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível salvar a resposta rápida.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar resposta rápida' : 'Nova resposta rápida'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="quick-reply-title" label="Título" required>
            <Input
              id="quick-reply-title"
              value={title}
              maxLength={80}
              placeholder="Ex.: Boas-vindas"
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>

          <FormField id="quick-reply-content" label="Conteúdo" required>
            <Textarea
              id="quick-reply-content"
              value={content}
              maxLength={4000}
              rows={6}
              placeholder="Escreva a mensagem que será reutilizada no atendimento."
              onChange={(event) => setContent(event.target.value)}
            />
          </FormField>

          {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
