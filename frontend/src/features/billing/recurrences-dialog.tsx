import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BillingRecurrence } from '@/types/billing';
import { formatCurrency, resolveBillingError } from './billing-utils';
import { useBillingRecurrences, useDeactivateRecurrence } from './queries';

interface RecurrencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}

export function RecurrencesDialog({ open, onOpenChange, canManage }: RecurrencesDialogProps) {
  const recurrences = useBillingRecurrences({ perPage: 50, active: true });
  const deactivate = useDeactivateRecurrence();
  const [pending, setPending] = useState<BillingRecurrence | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const confirmDeactivate = async (): Promise<void> => {
    if (!pending) {
      return;
    }
    setActionError(null);
    try {
      await deactivate.mutateAsync(pending.id);
      setPending(null);
    } catch (requestError) {
      setActionError(
        resolveBillingError(requestError, 'Não foi possível encerrar a recorrência.'),
      );
      setPending(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cobranças recorrentes</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Cada recorrência gera uma nova cobrança por mês até ser encerrada.
            </p>
          </DialogHeader>

          {actionError ? (
            <p className="rounded-md border border-danger/30 bg-danger/5 p-2 text-xs font-medium text-danger">
              {actionError}
            </p>
          ) : null}

          {recurrences.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : recurrences.isError ? (
            <p className="py-6 text-center text-sm text-danger">
              Não foi possível carregar as recorrências.
            </p>
          ) : recurrences.data.data.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title="Nenhuma recorrência ativa"
              description="Crie uma cobrança marcando a opção de repetir mensalmente."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Próxima</TableHead>
                    {canManage ? <TableHead className="text-right">Ações</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recurrences.data.data.map((recurrence) => (
                    <TableRow key={recurrence.id}>
                      <TableCell>{recurrence.contactName ?? recurrence.customerName ?? '—'}</TableCell>
                      <TableCell className="max-w-[10rem] truncate">{recurrence.description}</TableCell>
                      <TableCell>{formatCurrency(recurrence.amountCents)}</TableCell>
                      <TableCell>
                        <StatusBadge tone={recurrence.active ? 'info' : 'secondary'}>
                          {recurrence.nextRunDate}
                        </StatusBadge>
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setPending(recurrence)}>
                            Encerrar
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(value) => {
          if (!value) setPending(null);
        }}
        title="Encerrar recorrência"
        description={
          pending
            ? `Novas cobranças de "${pending.description}" não serão geradas. As já existentes permanecem.`
            : undefined
        }
        confirmLabel="Encerrar"
        destructive
        loading={deactivate.isPending}
        onConfirm={() => void confirmDeactivate()}
      />
    </>
  );
}
