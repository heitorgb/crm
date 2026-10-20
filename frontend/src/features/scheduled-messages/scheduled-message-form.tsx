import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CalendarClock, FileText, Loader2, Paperclip, Send, X } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { formatBytes } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';
import type {
  ScheduledMessage,
  ScheduledMessageInput,
  ScheduledMessageRecipientDefinition,
  ScheduledMessageRecurrence,
  ScheduledMessageType,
} from '@/types/scheduled-messages';
import {
  useCreateScheduledMessage,
  useUpdateScheduledMessage,
} from './queries';
import { RecipientPicker } from './recipient-picker';
import {
  defaultLocalDateTime,
  previewScheduledMessage,
  recurrenceLabel,
  toLocalInput,
} from './scheduled-message-utils';

interface ScheduledMessageFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule?: ScheduledMessage | null;
  initialRecipients?: ScheduledMessageRecipientDefinition[];
}

const variableChips = ['{nome}', '{empresa}', '{valor}'];

export function ScheduledMessageForm({
  open,
  onOpenChange,
  schedule,
  initialRecipients = [],
}: ScheduledMessageFormProps) {
  const tenantName = useAuthStore((state) => state.session?.tenant.name ?? '');
  const initialIds = useMemo(
    () =>
      new Set(
        initialRecipients
          .map((recipient) => recipient.conversationId)
          .filter((id): id is string => Boolean(id)),
      ),
    [initialRecipients],
  );
  const initialNames = useMemo(
    () =>
      new Map(
        initialRecipients
          .filter(
            (recipient): recipient is ScheduledMessageRecipientDefinition & {
              conversationId: string;
            } => Boolean(recipient.conversationId),
          )
          .map((recipient) => [recipient.conversationId, recipient.recipientName]),
      ),
    [initialRecipients],
  );

  const [type, setType] = useState<ScheduledMessageType>(schedule?.type ?? 'CAMPAIGN');
  const [title, setTitle] = useState(schedule?.title ?? '');
  const [content, setContent] = useState(schedule?.content ?? '');
  const [valor, setValor] = useState(schedule?.valor ?? '');
  const [recurrence, setRecurrence] = useState<ScheduledMessageRecurrence>(
    schedule?.recurrence ?? 'ONCE',
  );
  const [scheduledAt, setScheduledAt] = useState(
    schedule
      ? toLocalInput(schedule.nextRunAt ?? schedule.scheduledAt, schedule.timeZone)
      : defaultLocalDateTime(),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialIds);
  const [file, setFile] = useState<File | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const create = useCreateScheduledMessage();
  const update = useUpdateScheduledMessage();
  const pending = create.isPending || update.isPending;

  const previewName =
    [...selectedIds]
      .map((id) => initialNames.get(id))
      .find((name): name is string => Boolean(name)) ?? 'Cliente';
  const preview = previewScheduledMessage(content, {
    nome: previewName,
    empresa: tenantName,
    valor: valor.trim(),
  });
  const attachmentName = file?.name ?? (removeAttachment ? null : schedule?.attachmentFileName ?? null);

  const appendVariable = (variable: string): void => {
    setContent((current) => `${current}${current.endsWith(' ') || current.length === 0 ? '' : ' '}${variable}`);
  };

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (selected) {
      setFile(selected);
      setRemoveAttachment(false);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (title.trim().length === 0) {
      setError('Informe um título interno.');
      return;
    }
    if (content.trim().length === 0) {
      setError('Escreva o texto da mensagem.');
      return;
    }
    if (selectedIds.size === 0) {
      setError('Selecione ao menos um destinatário.');
      return;
    }
    if (!scheduledAt) {
      setError('Informe a data e a hora do envio.');
      return;
    }

    const input: ScheduledMessageInput = {
      type,
      title: title.trim(),
      content: content.trim(),
      valor: valor.trim() || null,
      recurrence,
      scheduledAt,
      conversationIds: [...selectedIds],
      file,
      removeAttachment,
    };

    try {
      if (schedule) {
        await update.mutateAsync({ id: schedule.id, input });
      } else {
        await create.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível salvar a mensagem agendada.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {schedule ? 'Editar mensagem agendada' : 'Nova mensagem agendada'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="scheduled-type" label="Tipo">
              <Select value={type} onValueChange={(value) => setType(value as ScheduledMessageType)}>
                <SelectTrigger id="scheduled-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAMPAIGN">Campanha</SelectItem>
                  <SelectItem value="REMINDER">Lembrete</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField id="scheduled-recurrence" label="Recorrência">
              <Select
                value={recurrence}
                onValueChange={(value) =>
                  setRecurrence(value as ScheduledMessageRecurrence)
                }
              >
                <SelectTrigger id="scheduled-recurrence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(recurrenceLabel) as ScheduledMessageRecurrence[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {recurrenceLabel[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <FormField id="scheduled-title" label="Título interno" required>
            <Input
              id="scheduled-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Campanha de retorno"
              maxLength={120}
            />
          </FormField>

          <FormField
            id="scheduled-content"
            label="Texto da mensagem"
            required
            description="Variáveis disponíveis: {nome}, {empresa} e {valor}."
          >
            <Textarea
              id="scheduled-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Olá, {nome}! ..."
              className="min-h-[130px] resize-y"
              maxLength={4000}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {variableChips.map((variable) => (
                <Button
                  key={variable}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendVariable(variable)}
                >
                  {variable}
                </Button>
              ))}
            </div>
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="scheduled-valor" label="Valor (opcional)">
              <Input
                id="scheduled-valor"
                value={valor}
                onChange={(event) => setValor(event.target.value)}
                placeholder="Ex.: R$ 150,00"
              />
            </FormField>
            <FormField id="scheduled-at" label="Data e hora" required>
              <Input
                id="scheduled-at"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Fuso: America/Sao_Paulo</p>
            </FormField>
          </div>

          <FormField id="scheduled-attachment" label="Anexo (opcional)">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileSelected}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip />
                Escolher imagem ou PDF
              </Button>
              {attachmentName ? (
                <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{attachmentName}</span>
                  {file ? <span className="text-muted-foreground">{formatBytes(file.size)}</span> : null}
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setRemoveAttachment(Boolean(schedule?.hasAttachment));
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remover anexo"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ) : null}
            </div>
            {schedule?.hasAttachment && !file ? (
              <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={removeAttachment}
                  onChange={(event) => setRemoveAttachment(event.target.checked)}
                  className="size-4 rounded border-border accent-primary"
                />
                Remover o anexo atual
              </label>
            ) : null}
          </FormField>

          <FormField id="scheduled-recipients" label="Destinatários" required>
            <RecipientPicker selectedIds={selectedIds} onChange={setSelectedIds} />
          </FormField>

          <div className="rounded-md border border-border bg-surface/60 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="size-3.5" />
              Prévia
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {preview || 'O texto da mensagem aparece aqui.'}
            </p>
            {attachmentName ? (
              <p className="mt-2 text-xs text-muted-foreground">Anexo: {attachmentName}</p>
            ) : null}
          </div>

          {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {schedule ? 'Salvar alterações' : 'Agendar mensagem'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
