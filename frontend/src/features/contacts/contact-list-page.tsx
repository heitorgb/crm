import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpDown,
  Ban,
  CalendarDays,
  Check,
  Contact as ContactIcon,
  History,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import type { Contact, ContactExtraFilter, ContactFilter, ContactSummary } from '@/types/crm';
import { StartConversationDialog } from '@/features/attendance/start-conversation-dialog';
import { ContactDetailSheet } from './contact-detail-sheet';
import { ContactForm } from './contact-form';
import { useContacts, useDeleteContact } from './queries';

const PAGE_SIZE = 20;

type SortKey = 'recent' | 'name' | 'updated';

const SORT_OPTIONS: Record<
  SortKey,
  { label: string; sort: 'createdAt' | 'updatedAt' | 'name'; order: 'asc' | 'desc' }
> = {
  recent: { label: 'Mais recentes', sort: 'createdAt', order: 'desc' },
  name: { label: 'Nome (A-Z)', sort: 'name', order: 'asc' },
  updated: { label: 'Atualizados recentemente', sort: 'updatedAt', order: 'desc' },
};

const EXTRA_FILTER_OPTIONS: {
  value: ContactExtraFilter;
  label: string;
  icon: typeof Users;
}[] = [
  { value: 'with_phone', label: 'Com telefone', icon: Phone },
  { value: 'with_email', label: 'Com e-mail', icon: Mail },
  { value: 'with_birth_date', label: 'Com data de nascimento', icon: CalendarDays },
  { value: 'with_address', label: 'Com endereço', icon: MapPin },
  { value: 'with_customer', label: 'Com cliente vinculado', icon: UserRound },
];

const FILTER_OPTIONS: {
  value: ContactFilter;
  label: string;
  icon: typeof Users;
  countKey: keyof ContactSummary;
}[] = [
  { value: 'all', label: 'Todos', icon: Users, countKey: 'total' },
  { value: 'primary', label: 'Principais', icon: Star, countKey: 'primary' },
  { value: 'blocked', label: 'Bloqueados', icon: Ban, countKey: 'blocked' },
  { value: 'incomplete', label: 'Dados incompletos', icon: TriangleAlert, countKey: 'incomplete' },
];

export function ContactListPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ContactFilter>('all');
  const [extraFilter, setExtraFilter] = useState<ContactExtraFilter | 'none'>('none');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null);
  const [startContact, setStartContact] = useState<Contact | null>(null);
  const [detailContact, setDetailContact] = useState<Contact | null>(null);

  const debouncedSearch = useDebouncedValue(search, 350);
  const deleteContact = useDeleteContact();
  const sort = SORT_OPTIONS[sortKey];

  const query = useContacts({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
    filter,
    extraFilter: extraFilter === 'none' ? undefined : extraFilter,
    sort: sort.sort,
    order: sort.order,
    includeSummary: true,
  });

  const summary = query.data?.summary;
  const hasActiveFilters =
    debouncedSearch.length > 0 || filter !== 'all' || extraFilter !== 'none';
  const activeExtraFilter = EXTRA_FILTER_OPTIONS.find((option) => option.value === extraFilter);

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

  const openEdit = (contact: Contact): void => {
    setEditing(contact);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const changeFilter = (nextFilter: ContactFilter): void => {
    setFilter(nextFilter);
    setPage(1);
  };

  const changeExtraFilter = (nextFilter: ContactExtraFilter | 'none'): void => {
    setExtraFilter(nextFilter);
    setPage(1);
  };

  const clearFilters = (): void => {
    setSearch('');
    setFilter('all');
    setExtraFilter('none');
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contatos"
        description="Gerencie sua base, converse e mantenha os dados sempre atualizados."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Novo contato
          </Button>
        }
      />

      <Card className="border-border/70 bg-surface/30 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Buscar por nome, telefone ou e-mail"
              className="w-full sm:max-w-md"
            />

            <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full gap-2 sm:w-auto">
                    <SlidersHorizontal />
                    {activeExtraFilter ? activeExtraFilter.label : 'Filtros'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Filtros adicionais</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => changeExtraFilter('none')}>
                    {extraFilter === 'none' ? <Check /> : <span className="size-4" />}
                    Sem filtro adicional
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {EXTRA_FILTER_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <DropdownMenuItem
                        key={option.value}
                        onSelect={() => changeExtraFilter(option.value)}
                      >
                        {extraFilter === option.value ? <Check /> : <Icon />}
                        {option.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full gap-2 sm:w-auto">
                    <ArrowUpDown />
                    <span className="text-muted-foreground">Ordenar:</span>
                    {sort.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                  {(Object.keys(SORT_OPTIONS) as SortKey[]).map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onSelect={() => {
                        setSortKey(key);
                        setPage(1);
                      }}
                    >
                      {sortKey === key ? <Check /> : <span className="size-4" />}
                      {SORT_OPTIONS[key].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {FILTER_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = filter === option.value;
              const count = summary?.[option.countKey];

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => changeFilter(option.value)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    active
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/70 bg-background/20 text-muted-foreground hover:border-primary/25 hover:bg-surface-hover hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {option.label}
                  {count !== undefined ? (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                        active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border-border/70">
        {query.isPending ? (
          <ContactRowsSkeleton />
        ) : query.isError ? (
          <div className="p-4">
            <EmptyState
              icon={ContactIcon}
              title="Não foi possível carregar os contatos"
              description="Tente novamente em alguns instantes."
              action={
                <Button variant="outline" onClick={() => void query.refetch()}>
                  <RefreshCw />
                  Tentar novamente
                </Button>
              }
            />
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={ContactIcon}
              title="Nenhum contato encontrado"
              description={
                hasActiveFilters
                  ? 'Ajuste a busca ou os filtros para encontrar contatos.'
                  : 'Cadastre o primeiro contato para começar.'
              }
              action={
                hasActiveFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Limpar filtros
                  </Button>
                ) : (
                  <Button onClick={openCreate}>
                    <Plus />
                    Novo contato
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Contato</TableHead>
                  <TableHead className="hidden xl:table-cell">Cargo / observação</TableHead>
                  <TableHead className="hidden sm:table-cell">Situação</TableHead>
                  <TableHead className="pr-4 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((contact) => (
                  <TableRow
                    key={contact.id}
                    tabIndex={0}
                    className="group cursor-pointer border-border/60 focus-visible:bg-surface-hover focus-visible:outline-none"
                    onClick={() => setDetailContact(contact)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDetailContact(contact);
                      }
                    }}
                  >
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          name={contact.name}
                          src={contact.avatarUrl ?? undefined}
                          className="size-9 shrink-0 ring-1 ring-border/60"
                        />
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                              {contact.name}
                            </span>
                            {contact.isPrimary ? (
                              <StatusBadge
                                tone="info"
                                withDot={false}
                                className="h-5 shrink-0 px-1.5 text-[10px]"
                              >
                                Principal
                              </StatusBadge>
                            ) : null}
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            {contact.phone ? (
                              <span className="font-mono text-[11px]">{contact.phone}</span>
                            ) : null}
                            {contact.phone && contact.email ? (
                              <span className="text-border">·</span>
                            ) : null}
                            {contact.email ? (
                              <span className="truncate">{contact.email}</span>
                            ) : null}
                            {!contact.phone && !contact.email ? (
                              <span className="italic">Sem telefone ou e-mail</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {contact.position ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {contact.isBlocked ? (
                        <StatusBadge tone="danger">Bloqueado</StatusBadge>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Check className="size-3.5 text-success" />
                          Recebendo
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="pr-4"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setStartContact(contact)}
                          disabled={!contact.phone}
                          aria-label={`Conversar com ${contact.name}`}
                          title={contact.phone ? 'Iniciar conversa' : 'Sem telefone cadastrado'}
                        >
                          <MessageSquare />
                          <span className="hidden sm:inline">Conversar</span>
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground"
                              aria-label={`Mais ações para ${contact.name}`}
                              title="Mais ações"
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="max-w-52 truncate">
                              {contact.name}
                            </DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => openEdit(contact)}>
                              <Pencil />
                              Editar contato
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to={`/contatos/${contact.id}`}>
                                <History />
                                Ver histórico
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onSelect={() => setPendingDelete(contact)}
                            >
                              <Trash2 />
                              Excluir contato
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">
                Mostrando{' '}
                {(query.data.meta.page - 1) * query.data.meta.perPage + 1}–
                {Math.min(
                  query.data.meta.page * query.data.meta.perPage,
                  query.data.meta.total,
                )}{' '}
                de {query.data.meta.total}
              </p>
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

      {detailContact ? (
        <ContactDetailSheet
          key={detailContact.id}
          contactId={detailContact.id}
          onOpenChange={(open) => {
            if (!open) setDetailContact(null);
          }}
          onEdit={(contact) => {
            setDetailContact(null);
            openEdit(contact);
          }}
          onStartConversation={setStartContact}
        />
      ) : null}

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

      <StartConversationDialog
        open={Boolean(startContact)}
        onOpenChange={(open) => {
          if (!open) setStartContact(null);
        }}
        contact={startContact ? { id: startContact.id, name: startContact.name } : null}
      />
    </div>
  );
}

function ContactRowsSkeleton() {
  return (
    <div className="space-y-1 p-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-1 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}
