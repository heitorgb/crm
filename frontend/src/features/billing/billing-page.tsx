import { useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BellRing,
  History,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { MetricCard } from '@/components/common/metric-card';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge } from '@/components/common/status-badge';
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
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatDate } from '@/lib/format';
import type { BillingCharge } from '@/types/billing';
import { chargeStatusLabel, chargeStatusTone, formatCurrency } from './billing-utils';
import { BillingSettingsDialog } from './billing-settings-dialog';
import { ChargeForm } from './charge-form';
import { ReminderHistoryDialog } from './reminder-history-dialog';
import { RecurrencesDialog } from './recurrences-dialog';
import { useBillingPermissions } from './use-billing-permissions';
import {
  useBillingCharges,
  useBillingOverview,
  useCancelCharge,
  usePayCharge,
} from './queries';

const PAGE_SIZE = 20;

export function BillingPage() {
  const { canManage } = useBillingPermissions();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<BillingCharge | null>(null);
  const [pendingPay, setPendingPay] = useState<BillingCharge | null>(null);
  const [pendingCancel, setPendingCancel] = useState<BillingCharge | null>(null);
  const [historyCharge, setHistoryCharge] = useState<BillingCharge | null>(null);
  const [recurrencesOpen, setRecurrencesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 350);
  const overview = useBillingOverview();
  const charges = useBillingCharges({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status === 'all' ? undefined : status,
    sort: 'dueDate',
    order: 'asc',
  });
  const payCharge = usePayCharge();
  const cancelCharge = useCancelCharge();

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const confirmPay = async (): Promise<void> => {
    if (!pendingPay) {
      return;
    }
    await payCharge.mutateAsync(pendingPay.id);
    setPendingPay(null);
  };

  const confirmCancel = async (): Promise<void> => {
    if (!pendingCancel) {
      return;
    }
    await cancelCharge.mutateAsync(pendingCancel.id);
    setPendingCancel(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cobranças"
        description="Controle manual de cobranças e lembretes por WhatsApp."
        actions={
          <>
            {canManage ? (
              <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                <BellRing />
                Lembretes
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setRecurrencesOpen(true)}>
              <Repeat />
              Recorrentes
            </Button>
            {canManage ? (
              <Button onClick={openCreate}>
                <Plus />
                Nova cobrança
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pendente"
          value={overview.data ? formatCurrency(overview.data.totalPendingCents) : '—'}
          icon={Wallet}
          hint={overview.data ? `${overview.data.pendingCount} cobrança(s)` : undefined}
        />
        <MetricCard
          label="Vencido"
          value={overview.data ? formatCurrency(overview.data.totalOverdueCents) : '—'}
          icon={AlertTriangle}
          hint={overview.data ? `${overview.data.overdueCount} cobrança(s)` : undefined}
        />
        <MetricCard
          label="Pago no período"
          value={overview.data ? formatCurrency(overview.data.totalPaidCents) : '—'}
          icon={BadgeCheck}
          hint={overview.data ? `${overview.data.paidCount} cobrança(s)` : undefined}
        />
        <MetricCard
          label="Lembretes com falha"
          value={overview.data ? String(overview.data.failedReminders) : '—'}
          icon={BellRing}
        />
      </div>

      {overview.data && overview.data.upcoming.length > 0 ? (
        <Card className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Próximos vencimentos
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {overview.data.upcoming.map((charge) => (
              <div
                key={charge.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {charge.contactName ?? charge.customerName ?? '—'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{charge.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatCurrency(charge.amountCents)}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(charge.dueDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Buscar por descrição ou cliente"
            className="sm:max-w-sm"
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="PENDING">Pendentes</SelectItem>
              <SelectItem value="OVERDUE">Vencidas</SelectItem>
              <SelectItem value="PAID">Pagas</SelectItem>
              <SelectItem value="CANCELED">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {charges.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : charges.isError ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-medium text-danger">Não foi possível carregar as cobranças.</p>
            <Button variant="outline" onClick={() => void charges.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : charges.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Receipt}
              title="Nenhuma cobrança encontrada"
              description={
                debouncedSearch || status !== 'all'
                  ? 'Ajuste os filtros para encontrar cobranças.'
                  : 'Cadastre a primeira cobrança para começar.'
              }
              action={
                canManage ? (
                  <Button onClick={openCreate}>
                    <Plus />
                    Nova cobrança
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.data.data.map((charge) => {
                  const isOpen = charge.status === 'PENDING' || charge.status === 'OVERDUE';
                  return (
                    <TableRow key={charge.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {charge.contactName ?? charge.customerName ?? '—'}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {charge.description}
                            {charge.recurrenceId ? ' · recorrente' : ''}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(charge.dueDate)}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {formatCurrency(charge.amountCents)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={chargeStatusTone(charge.status)}>
                          {chargeStatusLabel(charge.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canManage && isOpen ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              title="Marcar como paga"
                              aria-label="Marcar como paga"
                              onClick={() => setPendingPay(charge)}
                            >
                              <BadgeCheck />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title="Histórico de lembretes"
                            aria-label="Histórico de lembretes"
                            onClick={() => setHistoryCharge(charge)}
                          >
                            <History />
                          </Button>
                          {canManage && isOpen ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                title="Editar"
                                aria-label="Editar"
                                onClick={() => {
                                  setEditing(charge);
                                  setFormNonce((value) => value + 1);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-danger"
                                title="Cancelar cobrança"
                                aria-label="Cancelar cobrança"
                                onClick={() => setPendingCancel(charge)}
                              >
                                <AlertTriangle />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="border-t border-border p-4">
              <Pagination
                page={charges.data.meta.page}
                pageCount={charges.data.meta.totalPages}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      <ChargeForm key={formNonce} open={formOpen} onOpenChange={setFormOpen} charge={editing} />

      <ReminderHistoryDialog
        open={Boolean(historyCharge)}
        onOpenChange={(open) => {
          if (!open) setHistoryCharge(null);
        }}
        chargeId={historyCharge?.id}
        description={
          historyCharge
            ? `${historyCharge.contactName ?? historyCharge.customerName ?? ''} · ${historyCharge.description}`
            : undefined
        }
      />

      <RecurrencesDialog open={recurrencesOpen} onOpenChange={setRecurrencesOpen} canManage={canManage} />

      <BillingSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <ConfirmDialog
        open={Boolean(pendingPay)}
        onOpenChange={(open) => {
          if (!open) setPendingPay(null);
        }}
        title="Marcar cobrança como paga"
        description={
          pendingPay
            ? `Confirmar a baixa de ${formatCurrency(pendingPay.amountCents)} de ${
                pendingPay.contactName ?? pendingPay.customerName ?? 'cliente'
              }? Os lembretes futuros serão interrompidos.`
            : undefined
        }
        confirmLabel="Confirmar baixa"
        loading={payCharge.isPending}
        onConfirm={() => void confirmPay()}
      />

      <ConfirmDialog
        open={Boolean(pendingCancel)}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
        title="Cancelar cobrança"
        description={
          pendingCancel
            ? `A cobrança "${pendingCancel.description}" será cancelada e os lembretes interrompidos.`
            : undefined
        }
        confirmLabel="Cancelar cobrança"
        cancelLabel="Voltar"
        destructive
        loading={cancelCharge.isPending}
        onConfirm={() => void confirmCancel()}
      />
    </div>
  );
}
