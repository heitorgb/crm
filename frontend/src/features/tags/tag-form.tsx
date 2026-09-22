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
import { ApiError } from '@/lib/api-client';
import type { Tag } from '@/types/crm';
import { useCreateTag, useUpdateTag } from './queries';

interface TagFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag?: Tag | null;
}

const DEFAULT_COLOR = '#22C55E';

export function TagForm({ open, onOpenChange, tag }: TagFormProps) {
  const isEditing = Boolean(tag);
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();

  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);

  const pending = createTag.isPending || updateTag.isPending;

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (name.trim().length === 0) {
      setError('Informe o nome da tag.');
      return;
    }

    const payload = { name: name.trim(), color };

    try {
      if (tag) {
        await updateTag.mutateAsync({ id: tag.id, input: payload });
      } else {
        await createTag.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Não foi possível salvar a tag.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar tag' : 'Nova tag'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="tag-name" label="Nome" required>
            <Input id="tag-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>

          <FormField id="tag-color" label="Cor">
            <div className="flex items-center gap-2">
              <Input
                id="tag-color"
                type="color"
                value={color || DEFAULT_COLOR}
                onChange={(event) => setColor(event.target.value.toUpperCase())}
                className="h-9 w-16 cursor-pointer p-1"
              />
              <span className="font-mono text-xs text-muted-foreground">
                {color || 'Sem cor'}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setColor('')}>
                Sem cor
              </Button>
            </div>
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
