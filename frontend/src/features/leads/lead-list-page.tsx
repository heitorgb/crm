import { useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
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
import { formatRelative } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Lead, LeadStatus } from '@/types/sales';
import { LeadForm } from './lead-form';
import { LEAD_STATUS_OPTIONS, useDeleteLead, useLeads } from './queries';

const PAGE_SIZE = 20;

const statusTone: Record<LeadStatus, StatusTone> = {
  NEW: 'info',
  QUALIFYING: 'warning',
  QUALIFIED_WAITING_DIGEST: 'success',
  DISQUALIFIED: 'danger',
  NEEDS_HUMAN: 'accent',
  ASSIGNED: 'default',
};

export function LeadListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LeadStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Lead | null>(null);

  const debouncedSearch = useDebouncedValue(search, 350);
  const deleteLead = useDeleteLead();

  const query = useLeads({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status === 'ALL' ? undefined : status,
    sort: 'createdAt',
    order: 'desc',
  });

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const openEdit = (lead: Lead): void => {
    setEditing(lead);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        description="Qualificação e acompanhamento de leads."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Novo lead
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
            placeholder="Buscar por nome, telefone ou e-mail"
            className="sm:max-w-sm"
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as LeadStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-52" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              {LEAD_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
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
            <p className="text-sm font-medium text-danger">Não foi possível carregar os leads.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Users}
              title="Nenhum lead encontrado"
              description="Cadastre o primeiro lead ou ajuste os filtros."
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  Novo lead
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead className="hidden md:table-cell">Contato</TableHead>
                  <TableHead className="hidden lg:table-cell">Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Atualizado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {lead.name ?? lead.phone ?? 'Lead sem nome'}
                      </div>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {lead.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs"
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="font-mono text-xs">{lead.phone ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{lead.email ?? '—'}</div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{lead.source ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge tone={statusTone[lead.status]}>
                        {LEAD_STATUS_OPTIONS.find((option) => option.value === lead.status)?.label}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {formatRelative(lead.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(lead)}
                          aria-label="Editar lead"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(lead)}
                          aria-label="Excluir lead"
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

      <LeadForm key={formNonce} open={formOpen} onOpenChange={setFormOpen} lead={editing} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir lead"
        description={pendingDelete ? `O lead "${pendingDelete.name ?? pendingDelete.phone}" será removido.` : undefined}
        confirmLabel="Excluir"
        destructive
        loading={deleteLead.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          void deleteLead.mutateAsync(pendingDelete.id).then(() => setPendingDelete(null)).catch(() => setPendingDelete(null));
        }}
      />
    </div>
  );
}
