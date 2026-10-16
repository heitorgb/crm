import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import type { BillingSettings } from '@/types/billing';
import type { WhatsAppInstance } from '@/types/whatsapp';
import { parseOffsets, reminderScheduleExplanation, resolveBillingError, serializeOffsets } from './billing-utils';
import { useBillingSettings, useUpdateBillingSettings } from './queries';

interface BillingSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillingSettingsDialog({ open, onOpenChange }: BillingSettingsDialogProps) {
  const settings = useBillingSettings();
  const instances = useWhatsAppInstances({ perPage: 50, active: true });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lembretes de cobrança</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Configure quando e como os lembretes são enviados aos clientes.
          </p>
        </DialogHeader>

        {settings.isPending ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : settings.isError || !settings.data ? (
          <p className="py-8 text-center text-sm text-danger">
            Não foi possível carregar as configurações.
          </p>
        ) : (
          <BillingSettingsForm
            key={settings.dataUpdatedAt}
            settings={settings.data}
            instances={instances.data?.data ?? []}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BillingSettingsFormProps {
  settings: BillingSettings;
  instances: WhatsAppInstance[];
  onDone: () => void;
}

function BillingSettingsForm({ settings, instances, onDone }: BillingSettingsFormProps) {
  const updateSettings = useUpdateBillingSettings();

  const [remindersEnabled, setRemindersEnabled] = useState(settings.remindersEnabled);
  const [offsets, setOffsets] = useState(serializeOffsets(settings.reminderOffsets));
  const [template, setTemplate] = useState(settings.messageTemplate);
  const [instanceId, setInstanceId] = useState(settings.whatsappInstanceId ?? 'auto');
  const [startHour, setStartHour] = useState(String(settings.sendWindowStartHour));
  const [endHour, setEndHour] = useState(String(settings.sendWindowEndHour));
  const [error, setError] = useState<string | null>(null);

  const startNumeric = Number.parseInt(startHour, 10);
  const endNumeric = Number.parseInt(endHour, 10);
  const explanation = reminderScheduleExplanation({
    scanIntervalMinutes: settings.scanIntervalMinutes,
    timeZone: settings.timeZone,
    sendWindowStartHour: isValidHour(startNumeric) ? startNumeric : settings.sendWindowStartHour,
    sendWindowEndHour: isValidHour(endNumeric) ? endNumeric : settings.sendWindowEndHour,
  });

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    const parsedOffsets = parseOffsets(offsets);
    if (!parsedOffsets) {
      setError('Intervalos inválidos. Use números separados por vírgula, ex.: -3, 0, 3.');
      return;
    }
    if (parsedOffsets.length > 10) {
      setError('Use no máximo 10 intervalos de lembrete.');
      return;
    }
    if (template.trim().length === 0) {
      setError('Escreva a mensagem do lembrete.');
      return;
    }
    const start = Number.parseInt(startHour, 10);
    const end = Number.parseInt(endHour, 10);
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      start > 23 ||
      !Number.isInteger(end) ||
      end < 0 ||
      end > 23
    ) {
      setError('As horas devem estar entre 0 e 23.');
      return;
    }

    try {
      await updateSettings.mutateAsync({
        remindersEnabled,
        reminderOffsets: parsedOffsets,
        messageTemplate: template.trim(),
        whatsappInstanceId: instanceId === 'auto' ? null : instanceId,
        sendWindowStartHour: start,
        sendWindowEndHour: end,
      });
      onDone();
    } catch (requestError) {
      setError(
        resolveBillingError(requestError, 'Não foi possível salvar as configurações.'),
      );
    }
  };

  return (
    <>
      <div className="grid gap-4">
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Enviar lembretes automáticos</p>
            <p className="text-xs text-muted-foreground">
              Interrompidos automaticamente quando a cobrança é paga ou cancelada.
            </p>
          </div>
          <Switch checked={remindersEnabled} onCheckedChange={setRemindersEnabled} />
        </div>

        <FormField
          id="billing-offsets"
          label="Momentos do lembrete (dias em relação ao vencimento)"
          description="Negativo = antes, 0 = no dia, positivo = depois. Ex.: -3, 0, 3"
        >
          <Input
            id="billing-offsets"
            value={offsets}
            onChange={(event) => setOffsets(event.target.value)}
            placeholder="-3, 0, 3"
          />
        </FormField>

        <FormField
          id="billing-template"
          label="Mensagem"
          description="Variáveis: {cliente}, {descricao}, {valor}, {vencimento}"
        >
          <Textarea
            id="billing-template"
            value={template}
            maxLength={1000}
            rows={4}
            onChange={(event) => setTemplate(event.target.value)}
          />
        </FormField>

        <FormField
          id="billing-instance"
          label="Instância do WhatsApp"
          description="Automática usa a primeira instância conectada."
        >
          <Select value={instanceId} onValueChange={setInstanceId}>
            <SelectTrigger id="billing-instance">
              <SelectValue placeholder="Automática" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automática</SelectItem>
              {instances.map((instance) => (
                <SelectItem key={instance.id} value={instance.id}>
                  {instance.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="billing-start" label="Enviar a partir das">
            <Input
              id="billing-start"
              type="number"
              min={0}
              max={23}
              value={startHour}
              onChange={(event) => setStartHour(event.target.value)}
            />
          </FormField>
          <FormField id="billing-end" label="Enviar até as">
            <Input
              id="billing-end"
              type="number"
              min={0}
              max={23}
              value={endHour}
              onChange={(event) => setEndHour(event.target.value)}
            />
          </FormField>
        </div>

        <p className="rounded-md border border-border bg-surface/60 p-3 text-xs leading-relaxed text-muted-foreground">
          {explanation}
        </p>

        {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={updateSettings.isPending}>
          Cancelar
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? <Loader2 className="animate-spin" /> : null}
          Salvar
        </Button>
      </DialogFooter>
    </>
  );
}

function isValidHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}
