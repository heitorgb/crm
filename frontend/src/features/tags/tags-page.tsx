import { useState } from 'react';
import { Pencil, Plus, RefreshCw, Tags, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuthStore } from '@/stores/auth-store';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Tag } from '@/types/crm';
import { TagForm } from './tag-form';
import { useDeleteTag, useTags } from './queries';

export function TagsPage() {
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);

  const hasRole = useAuthStore((state) => state.hasRole);
  const canDelete = hasRole('OWNER', 'ADMIN');
  const debouncedSearch = useDebouncedValue(search, 350);
  const deleteTag = useDeleteTag();

  const query = useTags({
    perPage: 100,
    search: debouncedSearch || undefined,
    sort: 'name',
    order: 'asc',
  });

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const openEdit = (tag: Tag): void => {
    setEditing(tag);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    await deleteTag.mutateAsync(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tags"
        description="Organize clientes com etiquetas do seu negócio."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Nova tag
          </Button>
        }
      />

      <Card className="p-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar tag"
          className="sm:max-w-sm"
        />
      </Card>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-medium text-danger">Não foi possível carregar as tags.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Tags}
              title="Nenhuma tag cadastrada"
              description="Crie tags para segmentar clientes (ex.: VIP, Inadimplente, Parceiro)."
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  Nova tag
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead className="hidden sm:table-cell">Clientes</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((tag) => (
                <TableRow key={tag.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <span
                        className="size-3 rounded-full border border-border"
                        style={{ backgroundColor: tag.color ?? 'transparent' }}
                        aria-hidden
                      />
                      {tag.name}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{tag.customerCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(tag)}
                        aria-label="Editar tag"
                      >
                        <Pencil />
                      </Button>
                      {canDelete ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(tag)}
                          aria-label="Excluir tag"
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <TagForm key={formNonce} open={formOpen} onOpenChange={setFormOpen} tag={editing} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir tag"
        description={
          pendingDelete
            ? `A tag "${pendingDelete.name}" será removida de ${pendingDelete.customerCount} cliente(s).`
            : undefined
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteTag.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
