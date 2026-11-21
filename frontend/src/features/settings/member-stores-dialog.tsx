import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Member } from '@/types/settings';

export interface MemberStoreOption {
  id: string;
  name: string;
}

interface MemberStoresDialogProps {
  member: Member;
  stores: MemberStoreOption[];
  saving: boolean;
  onCancel: () => void;
  onSave: (storeIds: string[]) => void;
}

export function MemberStoresDialog({ member, stores, saving, onCancel, onSave }: MemberStoresDialogProps) {
  const [selected, setSelected] = useState<string[]>(member.storeIds);

  const toggle = (storeId: string): void => {
    setSelected((current) =>
      current.includes(storeId) ? current.filter((id) => id !== storeId) : [...current, storeId],
    );
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lojas de {member.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          O usuário verá apenas os pedidos dessas lojas e as conversas do WhatsApp vinculado a elas.
          Sem nenhuma loja marcada, ele acessa todas.
        </p>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {stores.map((store) => (
            <label
              key={store.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                checked={selected.includes(store.id)}
                onChange={() => toggle(store.id)}
                className="size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span className="text-sm">{store.name}</span>
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
