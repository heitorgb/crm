import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus, RefreshCw, Users } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAdminTenants } from './queries';
import { TenantForm } from './tenant-form';

const PAGE_SIZE = 20;

export function AdminTenantsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const navigate = useNavigate();
  const debouncedSearch = useDebouncedValue(search, 350);

  const query = useAdminTenants({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organizações"
        description="Crie e gerencie tenants e seus usuários."
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus />
            Nova organização
          </Button>
        }
      />

      <Card className="p-4">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar organização"
          className="sm:max-w-sm"
        />
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
            <p className="text-sm font-medium text-danger">
              Não foi possível carregar as organizações.
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Building2}
              title="Nenhuma organização"
              description={
                debouncedSearch
                  ? 'Ajuste a busca para encontrar organizações.'
                  : 'Crie a primeira organização para começar.'
              }
              action={
                <Button onClick={() => setFormOpen(true)}>
                  <Plus />
                  Nova organização
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organização</TableHead>
                  <TableHead className="hidden sm:table-cell">Membros</TableHead>
                  <TableHead className="hidden md:table-cell">Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <Link
                        to={`/admin/tenants/${tenant.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {tenant.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Users className="size-3.5" />
                        {tenant.memberCount}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {formatDate(tenant.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/admin/tenants/${tenant.id}`}>Gerenciar</Link>
                      </Button>
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

      <TenantForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(tenantId) => navigate(`/admin/tenants/${tenantId}`)}
      />
    </div>
  );
}
