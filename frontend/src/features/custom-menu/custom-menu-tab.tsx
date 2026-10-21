import { createElement, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Folder,
  Loader2,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { menuIcon } from '@/config/menu-icons';
import type { CustomMenuGroupDraft } from '@/types/custom-menu';
import { useCustomMenu, useSaveCustomMenu } from './queries';
import {
  cloneGroupDraft,
  createEmptyGroupDraft,
  toGroupDrafts,
  toSaveCustomMenuInput,
  validateCustomMenuGroups,
} from './custom-menu-utils';
import { CustomMenuGroupDialog } from './custom-menu-group-dialog';

interface CustomMenuTabProps {
  canManage: boolean;
}

export function CustomMenuTab({ canManage }: CustomMenuTabProps) {
  const query = useCustomMenu();
  const saveMenu = useSaveCustomMenu();
  const [draft, setDraft] = useState<CustomMenuGroupDraft[] | null>(null);
  const [dialog, setDialog] = useState<CustomMenuGroupDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomMenuGroupDraft | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );

  const groups = draft ?? toGroupDrafts(query.data ?? []);
  const dirty = draft !== null;
  const canCreate = canManage && !saveMenu.isPending && (draft !== null || query.data !== undefined);

  const currentGroups = (): CustomMenuGroupDraft[] => draft ?? toGroupDrafts(query.data ?? []);

  const openCreate = (): void => {
    if (!canCreate) {
      return;
    }
    setFeedback(null);
    setDialog(createEmptyGroupDraft());
  };

  const openEdit = (group: CustomMenuGroupDraft): void => {
    setFeedback(null);
    setDialog(cloneGroupDraft(group));
  };

  const persistGroups = async (
    groupsToSave: CustomMenuGroupDraft[],
    successMessage: string,
  ): Promise<void> => {
    setFeedback(null);
    const validationError = validateCustomMenuGroups(groupsToSave);

    if (validationError) {
      setFeedback({ tone: 'danger', message: validationError });
      return;
    }

    try {
      await saveMenu.mutateAsync(toSaveCustomMenuInput(groupsToSave));
      setDraft(null);
      setFeedback({ tone: 'success', message: successMessage });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError
            ? error.message
            : 'Não foi possível salvar o menu personalizado.',
      });
    }
  };

  const handleSaveGroup = (group: CustomMenuGroupDraft): void => {
    const base = currentGroups();
    const exists = base.some((item) => item.key === group.key);
    const next = exists
      ? base.map((item) => (item.key === group.key ? group : item))
      : [...base, group];

    setDraft(next);
    setDialog(null);
    void persistGroups(next, 'Grupo salvo e menu lateral atualizado.');
  };

  const moveGroup = (index: number, direction: -1 | 1): void => {
    const base = currentGroups();
    const target = index + direction;
    if (target < 0 || target >= base.length) {
      return;
    }

    const next = [...base];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  };

  const confirmDelete = (): void => {
    if (!pendingDelete) {
      return;
    }

    setDraft(currentGroups().filter((group) => group.key !== pendingDelete.key));
    setPendingDelete(null);
  };

  const handleSave = (): void => {
    void persistGroups(currentGroups(), 'Menu personalizado atualizado.');
  };

  const handleCancel = (): void => {
    setDraft(null);
    setFeedback(null);
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Menu Personalizado</CardTitle>
          <CardDescription>
            Crie grupos e atalhos para sistemas externos no menu lateral do CRM.
          </CardDescription>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={openCreate}
              disabled={!canCreate}
            >
              <Plus />
              Novo grupo
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={!dirty || saveMenu.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saveMenu.isPending}
            >
              {saveMenu.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Salvar alterações
            </Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Apenas proprietários e administradores podem alterar o menu personalizado.
          </p>
        ) : null}

        {feedback ? (
          <p
            className={cn(
              'text-xs font-medium',
              feedback.tone === 'success' ? 'text-success' : 'text-danger',
            )}
          >
            {feedback.message}
          </p>
        ) : null}

        {query.isError && query.data ? (
          <p className="text-xs font-medium text-warning">
            Não foi possível atualizar o menu agora. Exibindo a última configuração carregada.
          </p>
        ) : null}

        {query.isPending && !query.data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : query.isError && !query.data ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm font-medium text-danger">
              Não foi possível carregar o menu personalizado.
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Menu}
            title="Nenhum grupo personalizado"
            description="Crie grupos com atalhos para lojas, sistemas, aplicativos e parceiros."
            action={
              canCreate ? (
                <Button onClick={openCreate}>
                  <Plus />
                  Novo grupo
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {groups.map((group, index) => {
              return (
                <div key={group.key} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {createElement(menuIcon(group.icon, Folder), {
                          className: 'size-4',
                          'aria-hidden': true,
                        })}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {group.name.trim() || 'Grupo sem nome'}
                          </p>
                          <Badge variant={group.active ? 'success' : 'secondary'}>
                            {group.active ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {group.buttons.length === 0
                            ? 'Nenhum botão cadastrado'
                            : `${group.buttons.length} ${
                                group.buttons.length === 1 ? 'botão' : 'botões'
                              }`}
                        </p>
                      </div>
                    </div>

                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={saveMenu.isPending || index === 0}
                          aria-label={`Mover grupo ${group.name || index + 1} para cima`}
                          onClick={() => moveGroup(index, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={saveMenu.isPending || index === groups.length - 1}
                          aria-label={`Mover grupo ${group.name || index + 1} para baixo`}
                          onClick={() => moveGroup(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={saveMenu.isPending}
                          aria-label={`Editar grupo ${group.name || index + 1}`}
                          onClick={() => openEdit(group)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          disabled={saveMenu.isPending}
                          aria-label={`Excluir grupo ${group.name || index + 1}`}
                          onClick={() => setPendingDelete(group)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="p-3">
                    {group.buttons.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Adicione botões para que este grupo apareça no menu lateral.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {group.buttons.map((button) => {
                          return (
                            <li
                              key={button.key}
                              className={cn(
                                'flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2',
                                !button.active && 'opacity-60',
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {createElement(menuIcon(button.icon, ExternalLink), {
                                  className: 'size-4 shrink-0 text-muted-foreground',
                                  'aria-hidden': true,
                                })}
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {button.name.trim() || 'Botão sem nome'}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {button.url.trim() || 'URL não informada'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {button.active ? (
                                  <Badge variant="success">Ativo</Badge>
                                ) : (
                                  <Badge variant="secondary">Inativo</Badge>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {dialog ? (
        <CustomMenuGroupDialog
          key={dialog.key}
          initial={dialog}
          onClose={() => setDialog(null)}
          onSave={handleSaveGroup}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        title="Excluir grupo do menu"
        description={
          pendingDelete
            ? pendingDelete.buttons.length > 0
              ? `O grupo "${pendingDelete.name || 'sem nome'}" e seus ${
                  pendingDelete.buttons.length
                } botão(ões) serão removidos ao salvar as alterações.`
              : `O grupo "${pendingDelete.name || 'sem nome'}" será removido ao salvar as alterações.`
            : undefined
        }
        confirmLabel="Excluir grupo"
        destructive
        onConfirm={confirmDelete}
      />
    </Card>
  );
}
