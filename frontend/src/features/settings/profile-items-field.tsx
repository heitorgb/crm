import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export interface EditableProfileItem {
  key: string;
  label: string;
  description?: string;
  weight?: number;
  required?: boolean;
}

interface ProfileItemsFieldProps {
  items: EditableProfileItem[];
  onChange: (items: EditableProfileItem[]) => void;
  disabled?: boolean;
  showWeight?: boolean;
  showRequired?: boolean;
  addLabel?: string;
}

export function ProfileItemsField({
  items,
  onChange,
  disabled,
  showWeight,
  showRequired,
  addLabel = 'Adicionar item',
}: ProfileItemsFieldProps) {
  const updateItem = (index: number, patch: Partial<EditableProfileItem>): void => {
    onChange(items.map((item, current) => (current === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number): void => {
    onChange(items.filter((_, current) => current !== index));
  };

  const addItem = (): void => {
    onChange([...items, { key: '', label: '' }]);
  };

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum item configurado.</p>
      ) : null}

      {items.map((item, index) => (
        <div key={index} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Item {index + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-danger"
              onClick={() => removeItem(index)}
              disabled={disabled}
              aria-label="Remover item"
            >
              <X />
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={item.key}
              onChange={(event) => updateItem(index, { key: event.target.value })}
              placeholder="Chave (ex.: budget)"
              disabled={disabled}
              aria-label="Chave"
            />
            <Input
              value={item.label}
              onChange={(event) => updateItem(index, { label: event.target.value })}
              placeholder="Rótulo exibido"
              disabled={disabled}
              aria-label="Rótulo"
            />
          </div>

          <Input
            value={item.description ?? ''}
            onChange={(event) => updateItem(index, { description: event.target.value })}
            placeholder="Descrição para a IA (opcional)"
            disabled={disabled}
            aria-label="Descrição"
          />

          {showWeight ? (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Peso</Label>
              <Input
                type="number"
                min={0}
                max={1000}
                value={item.weight ?? ''}
                onChange={(event) =>
                  updateItem(index, {
                    weight: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
                className="w-24"
                disabled={disabled}
                aria-label="Peso"
              />
            </div>
          ) : null}

          {showRequired ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={item.required ?? false}
                onCheckedChange={(checked) => updateItem(index, { required: checked })}
                disabled={disabled}
                aria-label="Obrigatório"
              />
              <span className="text-xs text-muted-foreground">Informação obrigatória</span>
            </div>
          ) : null}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={disabled}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}
