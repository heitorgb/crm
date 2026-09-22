import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { usePipelines } from '@/features/pipelines/queries';
import type { Deal, DealStatus } from '@/types/sales';
import { DealForm } from './deal-form';
import { useDeals, useDeleteDeal } from './queries';

const PAGE_SIZE = 20;

const statusTone: Record<DealStatus, StatusTone> = {
  OPEN: 'info',
  WON: 'success',
  LOST: 'danger',
};

const statusLabel: Record<DealStatus, string> = {
  OPEN: 'Aberto',
  WON: 'Ganho',
  LOST: 'Perdido',
};

export function DealsListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DealStatus | 'ALL'>('ALL');
  const [pipelineId, setPipelineId] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Deal | null>(null);

  const debouncedSearch = useDebouncedValue(search, 350);
  const pipelinesQuery = usePipelines({ perPage: 100, sort: 'createdAt', order: 'asc' });
  const deleteDeal = useDeleteDeal();

  const query = useDeals({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status === 'ALL' ? undefined : status,
    pipelineId: pipelineId === 'ALL' ? undefined : pipelineId,
    sort: 'createdAt',
    order: 'desc',
  });

  const openEdit = (deal: Deal): void => {
    setEditing(deal);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Negócios"
        description="Negociações em andamento."
        actions={
          <Button variant="outline" asChild>
            <Link to="/vendas/funil">
              <Briefcase />
              Abrir funil
            </Link>
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Buscar negócio"
            className="sm:max-w-sm"
          />
          <Select
            value={pipelineId}
            onValueChange={(value) => {
              setPipelineId(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-52" aria-label="Filtrar por pipeline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os pipelines</SelectItem>
              {pipelinesQuery.data?.data.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as DealStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-40" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              <SelectItem value="OPEN">Aberto</SelectItem>
              <SelectItem value="WON">Ganho</SelectItem>
              <SelectItem value="LOST">Perdido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-medium text-danger">Não foi possível carregar os negócios.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Briefcase}
              title="Nenhum negócio encontrado"
              description="Crie negócios pelo quadro do funil."
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Negócio</TableHead>
                  <TableHead className="hidden md:table-cell">Etapa</TableHead>
                  <TableHead className="hidden lg:table-cell">Responsável</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{deal.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {deal.customerName ?? deal.leadName ?? 'Sem vínculo'}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="text-sm">{deal.stageName}</div>
                      <div className="text-xs text-muted-foreground">{deal.pipelineName}</div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{deal.ownerName ?? '—'}</TableCell>
                    <TableCell>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                        Number(deal.value),
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={statusTone[deal.status]}>{statusLabel[deal.status]}</StatusBadge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {formatDate(deal.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(deal)}
                          aria-label="Editar negócio"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(deal)}
                          aria-label="Excluir negócio"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="border-t border-border p-4">
              <Pagination
                page={query.data.meta.page}
                pageCount={query.data.meta.totalPages}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      {editing ? (
        <DealForm
          key={formNonce}
          open={formOpen}
          onOpenChange={setFormOpen}
          deal={editing}
          pipelineId={editing.pipelineId}
          stageId={editing.stageId}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir negócio"
        description={pendingDelete ? `O negócio "${pendingDelete.title}" será removido.` : undefined}
        confirmLabel="Excluir"
        destructive
        loading={deleteDeal.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          void deleteDeal.mutateAsync(pendingDelete.id).then(() => setPendingDelete(null)).catch(() => setPendingDelete(null));
        }}
      />
    </div>
  );
}
