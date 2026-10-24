import { useState } from 'react';
import {
  CalendarClock,
  CalendarPlus,
  Copy,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Repeat,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
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
import { useAuthStore } from '@/stores/auth-store';
import type {
  ScheduledMessage,
  ScheduledMessageRecipientDefinition,
  ScheduledMessageStatus,
  ScheduledMessageType,
} from '@/types/scheduled-messages';
import { scheduledMessagesService } from './services/scheduled-messages-service';
import { ScheduledMessageDetailDialog } from './scheduled-message-detail-dialog';
import { ScheduledMessageForm } from './scheduled-message-form';
import {
  formatInTimeZone,
  scheduleRecurrenceSummary,
  scheduledStatusLabel,
  scheduledStatusTone,
  scheduledTypeLabel,
  scheduledTypeTone,
} from './scheduled-message-utils';
import {
  useCancelScheduledMessage,
  useDuplicateScheduledMessage,
  useScheduledMessages,
} from './queries';

const PAGE_SIZE = 20;

export function ScheduledMessagesPage() {
  const role = useAuthStore((state) => state.session?.role);
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ScheduledMessageStatus | 'ALL'>('SCHEDULED');
  const [type, setType] = useState<ScheduledMessageType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [initialRecipients, setInitialRecipients] = useState<
    ScheduledMessageRecipientDefinition[]
  >([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<ScheduledMessage | null>(null);
  const [detail, setDetail] = useState<ScheduledMessage | null>(null);

  const query = useScheduledMessages({
    page,
    perPage: PAGE_SIZE,
    search: search || undefined,
    status,
    type,
    order: 'desc',
  });
  const cancel = useCancelScheduledMessage();
  const duplicate = useDuplicateScheduledMessage();

  const openCreate = (): void => {
    setEditing(null);
    setInitialRecipients([]);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const openEdit = async (schedule: ScheduledMessage): Promise<void> => {
    setLoadingRecipients(true);
    try {
      const recipients = await scheduledMessagesService.recipients(schedule.id);
      setEditing(schedule);
      setInitialRecipients(recipients);
      setFormNonce((value) => value + 1);
      setFormOpen(true);
    } finally {
      setLoadingRecipients(false);
    }
  };

  const confirmCancel = async (): Promise<void> => {
    if (!pendingCancel) return;
    await cancel.mutateAsync(pendingCancel.id);
    setPendingCancel(null);
  };

  const schedules = query.data?.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mensagens agendadas"
        description="Campanhas e lembretes enviados automaticamente pelo WhatsApp."
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <CalendarPlus />
              Nova mensagem
            </Button>
          ) : undefined
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
            placeholder="Buscar por título ou texto"
            className="flex-1 sm:max-w-sm"
          />
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value as ScheduledMessageType | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os tipos</SelectItem>
              <SelectItem value="CAMPAIGN">Campanhas</SelectItem>
              <SelectItem value="REMINDER">Lembretes</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as ScheduledMessageStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              <SelectItem value="SCHEDULED">Agendadas</SelectItem>
              <SelectItem value="PROCESSING">Enviando</SelectItem>
              <SelectItem value="SENT">Enviadas</SelectItem>
              <SelectItem value="FAILED">Falharam</SelectItem>
              <SelectItem value="CANCELED">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium text-danger">
            Não foi possível carregar as mensagens agendadas.
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            <RefreshCw />
            Tentar novamente
          </Button>
        </Card>
      ) : schedules.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={CalendarClock}
            title="Nenhuma mensagem agendada"
            description={
              search || status !== 'ALL' || type !== 'ALL'
                ? 'Ajuste os filtros para encontrar agendamentos.'
                : 'Crie uma campanha ou lembrete para enviar automaticamente.'
            }
            action={
              canManage ? (
                <Button onClick={openCreate}>
                  <CalendarPlus />
                  Nova mensagem
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {schedules.map((schedule) => (
              <Card key={schedule.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone={scheduledTypeTone[schedule.type]} withDot={false}>
                        {scheduledTypeLabel[schedule.type]}
                      </StatusBadge>
                      <StatusBadge tone={scheduledStatusTone[schedule.status]}>
                        {scheduledStatusLabel[schedule.status]}
                      </StatusBadge>
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold">{schedule.title}</p>
                  </div>
                  {schedule.hasAttachment ? (
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                      title={schedule.attachmentFileName ?? 'Anexo'}
                    >
                      <FileText className="size-4" />
                    </span>
                  ) : null}
                </div>

                <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                  {schedule.content}
                </p>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <CalendarClock className="size-3.5 shrink-0" />
                    {schedule.nextRunAt
                      ? `Próximo envio: ${formatInTimeZone(schedule.nextRunAt, schedule.timeZone)}`
                      : schedule.lastRunAt
                        ? `Último envio: ${formatInTimeZone(schedule.lastRunAt, schedule.timeZone)}`
                        : 'Sem próximo envio'}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Repeat className="size-3.5 shrink-0" />
                    {scheduleRecurrenceSummary(schedule)}
                  </p>
                  <p>{schedule.recipientCount} destinatário(s)</p>
                </div>

                <div className="mt-auto flex items-center justify-end gap-1 border-t border-border pt-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setDetail(schedule)}
                    title="Ver histórico"
                    aria-label="Ver histórico"
                  >
                    <Eye />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => duplicate.mutate({ id: schedule.id })}
                    disabled={duplicate.isPending}
                    title="Duplicar"
                    aria-label="Duplicar"
                  >
                    <Copy />
                  </Button>
                  {canManage && schedule.status === 'SCHEDULED' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => void openEdit(schedule)}
                      disabled={loadingRecipients}
                      title="Editar"
                      aria-label="Editar"
                    >
                      {loadingRecipients ? <Loader2 className="animate-spin" /> : <Pencil />}
                    </Button>
                  ) : null}
                  {canManage &&
                  (schedule.status === 'SCHEDULED' ||
                    (schedule.recurrence !== 'ONCE' && schedule.status === 'PROCESSING')) ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-danger"
                      onClick={() => setPendingCancel(schedule)}
                      disabled={cancel.isPending}
                      title={
                        schedule.recurrence === 'ONCE'
                          ? 'Cancelar agendamento'
                          : 'Finalizar recorrência'
                      }
                      aria-label={
                        schedule.recurrence === 'ONCE'
                          ? 'Cancelar agendamento'
                          : 'Finalizar recorrência'
                      }
                    >
                      <XCircle />
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <Pagination
              page={query.data.meta.page}
              pageCount={query.data.meta.totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}

      <ScheduledMessageForm
        key={formNonce}
        open={formOpen}
        onOpenChange={setFormOpen}
        schedule={editing}
        initialRecipients={initialRecipients}
      />

      <ScheduledMessageDetailDialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        schedule={detail}
      />

      <ConfirmDialog
        open={Boolean(pendingCancel)}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
        title={
          pendingCancel?.recurrence === 'ONCE'
            ? 'Cancelar mensagem agendada'
            : 'Finalizar recorrência'
        }
        description={
          pendingCancel
            ? pendingCancel.recurrence === 'ONCE'
              ? `O agendamento "${pendingCancel.title}" será cancelado. Envios já realizados não serão desfeitos.`
              : `A recorrência de "${pendingCancel.title}" será finalizada. Não haverá novos envios após a finalização. Os envios já realizados e o histórico serão preservados.`
            : undefined
        }
        confirmLabel={
          pendingCancel?.recurrence === 'ONCE' ? 'Cancelar agendamento' : 'Finalizar recorrência'
        }
        cancelLabel="Voltar"
        destructive
        loading={cancel.isPending}
        onConfirm={() => void confirmCancel()}
      />
    </div>
  );
}
