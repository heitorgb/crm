import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Contact as ContactIcon, History, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Contact } from '@/types/crm';
import { ContactForm } from './contact-form';
import { useContacts, useDeleteContact } from './queries';

const PAGE_SIZE = 20;

export function ContactListPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null);

  const debouncedSearch = useDebouncedValue(search, 350);
  const deleteContact = useDeleteContact();

  const query = useContacts({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
    sort: 'createdAt',
    order: 'desc',
  });

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    await deleteContact.mutateAsync(pendingDelete.id);
    setPendingDelete(null);
  };

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contatos"
        description="Pessoas que conversam com os seus WhatsApps."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Novo contato
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
          placeholder="Buscar por nome, e-mail ou telefone"
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
            <p className="text-sm font-medium text-danger">Não foi possível carregar os contatos.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={ContactIcon}
              title="Nenhum contato encontrado"
              description={
                debouncedSearch
                  ? 'Ajuste a busca para encontrar contatos.'
                  : 'Cadastre o primeiro contato para começar.'
              }
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  Novo contato
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead className="hidden lg:table-cell">Telefone</TableHead>
                  <TableHead className="hidden lg:table-cell">Cargo / observação</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <Link
                        to={`/contatos/${contact.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {contact.name}
                      </Link>
                      {contact.email ? (
                        <div className="text-xs text-muted-foreground">{contact.email}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {contact.phone ?? '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{contact.position ?? '—'}</TableCell>
                    <TableCell>
                      {contact.isPrimary ? (
                        <StatusBadge tone="info">Principal</StatusBadge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" asChild>
                          <Link to={`/contatos/${contact.id}`} aria-label="Ver histórico">
                            <History />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => {
                            setEditing(contact);
                            setFormNonce((value) => value + 1);
                            setFormOpen(true);
                          }}
                          aria-label="Editar contato"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(contact)}
                          aria-label="Excluir contato"
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

      <ContactForm key={formNonce} open={formOpen} onOpenChange={setFormOpen} contact={editing} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir contato"
        description={pendingDelete ? `O contato "${pendingDelete.name}" será removido.` : undefined}
        confirmLabel="Excluir"
        destructive
        loading={deleteContact.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
