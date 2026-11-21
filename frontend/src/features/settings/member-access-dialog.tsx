import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface MemberAccessOption {
  id: string;
  name: string;
}

interface MemberAccessDialogProps {
  title: string;
  description: string;
  options: MemberAccessOption[];
  initialSelected: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (selected: string[]) => void;
}

export function MemberAccessDialog({
  title,
  description,
  options,
  initialSelected,
  saving,
  onCancel,
  onSave,
}: MemberAccessDialogProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const toggle = (id: string): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
                className="size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span className="text-sm">{option.name}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onSave(selected)} disabled={saving}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
