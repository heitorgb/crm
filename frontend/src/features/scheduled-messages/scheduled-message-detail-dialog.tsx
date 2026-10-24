import { CalendarClock, Loader2, RefreshCw } from 'lucide-react';
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
import type { ScheduledMessage } from '@/types/scheduled-messages';
import { useRetryScheduledMessage, useScheduledMessageLogs } from './queries';
import {
  formatInTimeZone,
  scheduleRecurrenceSummary,
  scheduledRecipientStatusLabel,
  scheduledRecipientStatusTone,
  scheduledStatusLabel,
  scheduledStatusTone,
} from './scheduled-message-utils';

interface ScheduledMessageDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: ScheduledMessage | null;
}

export function ScheduledMessageDetailDialog({
  open,
  onOpenChange,
  schedule,
}: ScheduledMessageDetailDialogProps) {
  const logs = useScheduledMessageLogs(open ? schedule?.id : undefined);
  const retry = useRetryScheduledMessage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{schedule?.title ?? 'Histórico de envios'}</DialogTitle>
        </DialogHeader>

        {schedule ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tone={scheduledStatusTone[schedule.status]}>
              {scheduledStatusLabel[schedule.status]}
            </StatusBadge>
            <span>{schedule.recipientCount} destinatário(s)</span>
            <span>{scheduleRecurrenceSummary(schedule)}</span>
            {schedule.nextRunAt ? (
              <span>Próximo: {formatInTimeZone(schedule.nextRunAt, schedule.timeZone)}</span>
            ) : null}
          </div>
        ) : null}

        {logs.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : logs.isError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm font-medium text-danger">
              Não foi possível carregar o histórico.
            </p>
            <Button variant="outline" size="sm" onClick={() => void logs.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : (logs.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhum envio ainda"
            description="O histórico aparecerá aqui quando o horário chegar."
          />
        ) : (
          <div className="space-y-4">
            {logs.data?.map((run) => (
              <div key={run.scheduledFor} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {formatInTimeZone(run.scheduledFor, schedule?.timeZone ?? 'America/Sao_Paulo')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {run.sent} enviado(s) · {run.failed} falha(s) · {run.pending} pendente(s)
                    </p>
                  </div>
                  <StatusBadge
                    tone={scheduledRecipientStatusTone[run.status]}
                    withDot={false}
                  >
                    {scheduledRecipientStatusLabel[run.status]}
                  </StatusBadge>
                </div>

                <div className="space-y-1">
                  {run.recipients.map((recipient) => (
                    <div
                      key={recipient.id}
                      className="flex items-center gap-2 rounded-md bg-surface/60 px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{recipient.recipientName}</p>
                        {recipient.errorCode ? (
                          <p className="truncate text-[11px] text-danger">
                            {recipient.errorMessage ?? recipient.errorCode}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge
                        tone={scheduledRecipientStatusTone[recipient.status]}
                        withDot={false}
                      >
                        {scheduledRecipientStatusLabel[recipient.status]}
                      </StatusBadge>
                    </div>
                  ))}
                </div>

                {run.failed > 0 && schedule?.status !== 'CANCELED' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      retry.mutate({
                        id: schedule?.id as string,
                        scheduledFor: run.scheduledFor,
                      })
                    }
                    disabled={retry.isPending}
                  >
                    {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Reenviar falhas desta ocorrência
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
