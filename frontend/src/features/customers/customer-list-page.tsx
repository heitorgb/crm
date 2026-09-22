import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
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
import type { Customer, CustomerStatus } from '@/types/crm';
import { CustomerForm } from './customer-form';
import { useCustomers, useDeleteCustomer } from './queries';

const PAGE_SIZE = 20;

const statusTone: Record<CustomerStatus, StatusTone> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  ARCHIVED: 'outline',
};

const statusLabel: Record<CustomerStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  ARCHIVED: 'Arquivado',
};

export function CustomerListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CustomerStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Customer | null>(null);

  const debouncedSearch = useDebouncedValue(search, 350);
  const deleteCustomer = useDeleteCustomer();

  const query = useCustomers({
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

  const openEdit = (customer: Customer): void => {
    setEditing(customer);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    await deleteCustomer.mutateAsync(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        description="Base de clientes da organização."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Novo cliente
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
            placeholder="Buscar por nome ou documento"
            className="sm:max-w-sm"
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as CustomerStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              <SelectItem value="ACTIVE">Ativo</SelectItem>
              <SelectItem value="INACTIVE">Inativo</SelectItem>
              <SelectItem value="ARCHIVED">Arquivado</SelectItem>
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
            <p className="text-sm font-medium text-danger">Não foi possível carregar os clientes.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Users}
              title="Nenhum cliente encontrado"
              description={
                debouncedSearch || status !== 'ALL'
                  ? 'Ajuste a busca ou o filtro para encontrar clientes.'
                  : 'Cadastre o primeiro cliente para começar.'
              }
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  Novo cliente
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Contatos</TableHead>
                  <TableHead className="hidden lg:table-cell">Tags</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Link
                        to={`/clientes/clientes/${customer.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {customer.name}
                      </Link>
                      {customer.document ? (
                        <div className="font-mono text-xs text-muted-foreground">{customer.document}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{customer.contactCount}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {customer.tags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          customer.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs"
                            >
                              <span
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: tag.color ?? 'currentColor' }}
                                aria-hidden
                              />
                              {tag.name}
                            </span>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={statusTone[customer.status]}>
                        {statusLabel[customer.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {formatDate(customer.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" asChild>
                          <Link to={`/clientes/clientes/${customer.id}`} aria-label="Abrir cliente">
                            <ExternalLink />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(customer)}
                          aria-label="Editar cliente"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(customer)}
                          aria-label="Excluir cliente"
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

      <CustomerForm
        key={formNonce}
        open={formOpen}
        onOpenChange={setFormOpen}
        customer={editing}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir cliente"
        description={
          pendingDelete
            ? `O cliente "${pendingDelete.name}" e seus contatos serão removidos. Esta ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteCustomer.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
