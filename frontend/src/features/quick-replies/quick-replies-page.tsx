import { useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAuthStore } from '@/stores/auth-store';
import type { QuickReply } from '@/types/quick-replies';
import { QuickReplyForm } from './quick-reply-form';
import { useDeleteQuickReply, useQuickReplies } from './queries';

export function QuickRepliesPage() {
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuickReply | null>(null);

  const hasRole = useAuthStore((state) => state.hasRole);
  const canManage = hasRole('OWNER', 'ADMIN');
  const debouncedSearch = useDebouncedValue(search, 350);
  const deleteQuickReply = useDeleteQuickReply();

  const query = useQuickReplies({
    perPage: 100,
    search: debouncedSearch || undefined,
    sort: 'title',
    order: 'asc',
  });

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const openEdit = (quickReply: QuickReply): void => {
    setEditing(quickReply);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    await deleteQuickReply.mutateAsync(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Respostas rápidas"
        description="Modelos de mensagem reutilizáveis para agilizar o atendimento."
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus />
              Nova resposta
            </Button>
          ) : undefined
        }
      />

      <Card className="p-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por título ou conteúdo"
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
            <p className="text-sm font-medium text-danger">
              Não foi possível carregar as respostas rápidas.
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Zap}
              title="Nenhuma resposta rápida cadastrada"
              description={
                debouncedSearch
                  ? 'Ajuste a busca para encontrar respostas rápidas.'
                  : 'Cadastre modelos de mensagem para reutilizar durante o atendimento.'
              }
              action={
                canManage ? (
                  <Button onClick={openCreate}>
                    <Plus />
                    Nova resposta
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resposta</TableHead>
                <TableHead className="hidden md:table-cell">Conteúdo</TableHead>
                <TableHead className="hidden sm:table-cell">Atualizada em</TableHead>
                {canManage ? <TableHead className="text-right">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((quickReply) => (
                <TableRow key={quickReply.id}>
                  <TableCell>
                    <span className="font-medium text-foreground">{quickReply.title}</span>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground md:hidden">
                      {quickReply.content}
                    </p>
                  </TableCell>
                  <TableCell className="hidden max-w-md md:table-cell">
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {quickReply.content}
                    </p>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
                    {formatDateTime(quickReply.updatedAt)}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(quickReply)}
                          aria-label="Editar resposta rápida"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(quickReply)}
                          aria-label="Excluir resposta rápida"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <QuickReplyForm
        key={formNonce}
        open={formOpen}
        onOpenChange={setFormOpen}
        quickReply={editing}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir resposta rápida"
        description={
          pendingDelete
            ? `A resposta "${pendingDelete.title}" será removida permanentemente.`
            : undefined
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteQuickReply.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
