import { useState } from 'react';
import { Headset, RefreshCw, Ticket as TicketIcon } from 'lucide-react';
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
import type { TicketPriority, TicketStatus } from '@/types/attendance';
import { useTickets, useUpdateTicket } from './queries';

const PAGE_SIZE = 20;

const statusTone: Record<TicketStatus, StatusTone> = {
  OPEN: 'warning',
  PENDING: 'info',
  RESOLVED: 'success',
  CLOSED: 'secondary',
};

const priorityTone: Record<TicketPriority, StatusTone> = {
  LOW: 'secondary',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

const statusLabel: Record<TicketStatus, string> = {
  OPEN: 'Aberto',
  PENDING: 'Pendente',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
};

const priorityLabel: Record<TicketPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export function TicketsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TicketStatus | 'ALL'>('ALL');
  const [priority, setPriority] = useState<TicketPriority | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebouncedValue(search, 350);
  const updateTicket = useUpdateTicket();

  const query = useTickets({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status === 'ALL' ? undefined : status,
    priority: priority === 'ALL' ? undefined : priority,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tickets"
        description="Exceções e atendimentos que precisam de humano."
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Buscar ticket"
            className="sm:max-w-sm"
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as TicketStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              {Object.entries(statusLabel).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priority}
            onValueChange={(value) => {
              setPriority(value as TicketPriority | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por prioridade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as prioridades</SelectItem>
              {Object.entries(priorityLabel).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
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
            <p className="text-sm font-medium text-danger">Não foi possível carregar os tickets.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={TicketIcon}
              title="Nenhum ticket"
              description="Tickets são criados automaticamente quando o bot precisa de humano."
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Prioridade</TableHead>
                  <TableHead className="hidden md:table-cell">Responsável</TableHead>
                  <TableHead className="hidden lg:table-cell">Aberto</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{ticket.subject}</div>
                      <div className="text-xs text-muted-foreground">
                        {ticket.leadName ?? ticket.customerName ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={statusTone[ticket.status]}>
                        {statusLabel[ticket.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge tone={priorityTone[ticket.priority]}>
                        {priorityLabel[ticket.priority]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {ticket.assigneeName ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {formatRelative(ticket.openedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void updateTicket.mutateAsync({
                              id: ticket.id,
                              input: { status: 'RESOLVED' },
                            })
                          }
                          disabled={updateTicket.isPending}
                        >
                          <Headset />
                          Resolver
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
    </div>
  );
}
