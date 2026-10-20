import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TagPicker } from '@/features/tags/tag-picker';
import { ApiError } from '@/lib/api-client';
import type { Conversation } from '@/types/attendance';
import { conversationLabel } from './attendance-utils';
import { useUpdateConversationTags } from './queries';

interface ConversationTagsDialogProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConversationTagsDialog({
  conversation,
  open,
  onOpenChange,
}: ConversationTagsDialogProps) {
  const updateTags = useUpdateConversationTags();
  const [tagIds, setTagIds] = useState<string[]>(
    (conversation.tags ?? []).map((tag) => tag.id),
  );
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setError(null);
    try {
      await updateTags.mutateAsync({ id: conversation.id, tagIds });
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível atualizar as etiquetas.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Etiquetas da conversa</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {conversationLabel(conversation)}
          </p>
          <TagPicker
            value={tagIds}
            onValueChange={setTagIds}
            disabled={updateTags.isPending}
          />
          {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updateTags.isPending}
          >
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={updateTags.isPending}>
            {updateTags.isPending ? <Loader2 className="animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
