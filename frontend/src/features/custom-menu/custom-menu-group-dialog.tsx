import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { CustomMenuButtonDraft, CustomMenuGroupDraft } from '@/types/custom-menu';
import {
  cloneGroupDraft,
  createEmptyButtonDraft,
  MAX_CUSTOM_MENU_BUTTONS_PER_GROUP,
  validateCustomMenuGroups,
} from './custom-menu-utils';
import { MenuIconSelect } from './menu-icon-select';

interface CustomMenuGroupDialogProps {
  initial: CustomMenuGroupDraft;
  onSave: (group: CustomMenuGroupDraft) => void;
  onClose: () => void;
}

export function CustomMenuGroupDialog({
  initial,
  onSave,
  onClose,
}: CustomMenuGroupDialogProps) {
  const [draft, setDraft] = useState(() => cloneGroupDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const isEditing = Boolean(initial.id);

  const updateButton = (
    key: string,
    changes: Partial<CustomMenuButtonDraft>,
  ): void => {
    setDraft((current) => ({
      ...current,
      buttons: current.buttons.map((button) =>
        button.key === key ? { ...button, ...changes } : button,
      ),
    }));
  };

  const moveButton = (index: number, direction: -1 | 1): void => {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.buttons.length) {
        return current;
      }

      const buttons = [...current.buttons];
      [buttons[index], buttons[target]] = [buttons[target], buttons[index]];
      return { ...current, buttons };
    });
  };

  const removeButton = (key: string): void => {
    setDraft((current) => ({
      ...current,
      buttons: current.buttons.filter((button) => button.key !== key),
    }));
  };

  const handleSave = (): void => {
    setError(null);

    const normalized: CustomMenuGroupDraft = {
      ...draft,
      name: draft.name.trim(),
      buttons: draft.buttons.map((button) => ({
        ...button,
        name: button.name.trim(),
        url: button.url.trim(),
      })),
    };

    const validationError = validateCustomMenuGroups([normalized]);
    if (validationError) {
      setError(validationError);
      return;
    }

    onSave(normalized);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar grupo de menu' : 'Novo grupo de menu'}</DialogTitle>
          <DialogDescription>
            Defina o grupo e os atalhos externos que aparecerão no menu lateral.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <FormField id="custom-menu-group-name" label="Nome do menu" required>
              <Input
                id="custom-menu-group-name"
                value={draft.name}
                maxLength={80}
                placeholder="Ex.: Lojas, Sistemas, Parceiros"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </FormField>

            <FormField id="custom-menu-group-icon" label="Ícone">
              <MenuIconSelect
                id="custom-menu-group-icon"
                value={draft.icon}
                ariaLabel="Ícone do grupo"
                onChange={(icon) => setDraft((current) => ({ ...current, icon }))}
              />
            </FormField>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Grupo ativo</p>
              <p className="text-xs text-muted-foreground">
                Grupos inativos não aparecem no menu lateral.
              </p>
            </div>
            <Switch
              checked={draft.active}
              onCheckedChange={(active) =>
                setDraft((current) => ({ ...current, active }))
              }
              aria-label="Grupo ativo"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Botões do grupo</p>
                <p className="text-xs text-muted-foreground">
                  Os links abrem em uma nova aba.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.buttons.length >= MAX_CUSTOM_MENU_BUTTONS_PER_GROUP}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    buttons: [...current.buttons, createEmptyButtonDraft()],
                  }))
                }
              >
                <Plus />
                Adicionar botão
              </Button>
            </div>

            {draft.buttons.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Nenhum botão adicionado. O grupo só aparecerá no menu quando tiver ao menos um
                botão ativo.
              </p>
            ) : (
              <div className="space-y-3">
                {draft.buttons.map((button, index) => (
                  <div key={button.key} className="space-y-3 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Botão {index + 1}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={index === 0}
                          aria-label="Mover botão para cima"
                          onClick={() => moveButton(index, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={index === draft.buttons.length - 1}
                          aria-label="Mover botão para baixo"
                          onClick={() => moveButton(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          aria-label="Remover botão"
                          onClick={() => removeButton(button.key)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField id={`button-name-${button.key}`} label="Nome do botão" required>
                        <Input
                          id={`button-name-${button.key}`}
                          value={button.name}
                          maxLength={80}
                          placeholder="Ex.: Sistema interno"
                          onChange={(event) =>
                            updateButton(button.key, { name: event.target.value })
                          }
                        />
                      </FormField>

                      <FormField id={`button-url-${button.key}`} label="URL" required>
                        <Input
                          id={`button-url-${button.key}`}
                          value={button.url}
                          maxLength={2048}
                          inputMode="url"
                          placeholder="https://sistema.exemplo.com"
                          onChange={(event) =>
                            updateButton(button.key, { url: event.target.value })
                          }
                        />
                      </FormField>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <FormField id={`button-icon-${button.key}`} label="Ícone">
                        <MenuIconSelect
                          id={`button-icon-${button.key}`}
                          value={button.icon}
                          ariaLabel={`Ícone do botão ${index + 1}`}
                          onChange={(icon) => updateButton(button.key, { icon })}
                        />
                      </FormField>

                      <div className="flex items-center gap-3 sm:justify-end">
                        <span className="text-sm font-medium">Ativo</span>
                        <Switch
                          checked={button.active}
                          onCheckedChange={(active) => updateButton(button.key, { active })}
                          aria-label={`Botão ${index + 1} ativo`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave}>
            Salvar grupo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
