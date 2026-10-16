import { Bell } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { offsetLabel, reminderStatusLabel, reminderStatusTone } from './billing-utils';
import { useChargeReminders } from './queries';

interface ReminderHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargeId?: string | null;
  description?: string;
}

export function ReminderHistoryDialog({
  open,
  onOpenChange,
  chargeId,
  description,
}: ReminderHistoryDialogProps) {
  const reminders = useChargeReminders(chargeId ?? undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico de lembretes</DialogTitle>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </DialogHeader>

        {reminders.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : reminders.isError ? (
          <p className="py-6 text-center text-sm text-danger">
            Não foi possível carregar o histórico de lembretes.
          </p>
        ) : reminders.data.data.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nenhum lembrete ainda"
            description="Os lembretes aparecem aqui conforme forem agendados e enviados."
          />
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Agendado</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Destino</TableHead>
                  <TableHead>Detalhe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reminders.data.data.map((reminder) => (
                  <TableRow key={reminder.id}>
                    <TableCell className="whitespace-nowrap">
                      {offsetLabel(reminder.offsetDays)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {reminder.scheduledFor}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={reminderStatusTone(reminder.status)}>
                        {reminderStatusLabel(reminder.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">
                      {reminder.destination ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {reminder.status === 'SENT' && reminder.processedAt
                        ? `Enviado em ${formatDateTime(reminder.processedAt)}`
                        : reminder.errorMessage ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
