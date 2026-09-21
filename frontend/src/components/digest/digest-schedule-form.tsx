import { Clock, Info, Mail, MessageCircle, Monitor } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { DigestChannel, DigestSettings } from '@/types/qualification';

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Rio_Branco',
  'UTC',
];

const channels: Array<{ value: DigestChannel; label: string; icon: LucideIcon }> = [
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'email', label: 'E-mail', icon: Mail },
  { value: 'in_app', label: 'No CRM', icon: Monitor },
];

interface DigestScheduleFormProps {
  value: DigestSettings;
  onChange: (value: DigestSettings) => void;
  onSubmit: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
}

export function DigestScheduleForm({
  value,
  onChange,
  onSubmit,
  saving = false,
  saveDisabled = false,
}: DigestScheduleFormProps) {
  const update = (patch: Partial<DigestSettings>): void => onChange({ ...value, ...patch });

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-surface p-4">
        <div className="space-y-0.5">
          <Label htmlFor="digest-enabled" className="text-sm font-medium">
            Ativar resumo diário
          </Label>
          <p className="text-xs text-muted-foreground">
            Receba os leads qualificados agrupados no horário escolhido.
          </p>
        </div>
        <Switch
          id="digest-enabled"
          checked={value.enabled}
          onCheckedChange={(checked) => update({ enabled: checked })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="digest-time" label="Horário de entrega" description="No fuso selecionado ao lado.">
          <div className="relative">
            <Clock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="digest-time"
              type="time"
              value={value.time}
              onChange={(event) => update({ time: event.target.value })}
              disabled={!value.enabled}
              className="pl-8"
            />
          </div>
        </FormField>

        <FormField id="digest-timezone" label="Fuso horário">
          <Select
            value={value.timezone}
            onValueChange={(timezone) => update({ timezone })}
            disabled={!value.enabled}
          >
            <SelectTrigger id="digest-timezone">
              <SelectValue placeholder="Selecione o fuso" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((timezone) => (
                <SelectItem key={timezone} value={timezone}>
                  {timezone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <FormField id="digest-channel" label="Canal de recebimento">
        <Select
          value={value.channel}
          onValueChange={(channel) => update({ channel: channel as DigestChannel })}
          disabled={!value.enabled}
        >
          <SelectTrigger id="digest-channel">
            <SelectValue placeholder="Selecione o canal" />
          </SelectTrigger>
          <SelectContent>
            {channels.map((channel) => (
              <SelectItem key={channel.value} value={channel.value}>
                {channel.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <div className="flex items-start gap-2 rounded-md border border-info/20 bg-info/5 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
        <p>
          A preferência é individual da sua membership. O resumo nunca mistura leads de tenants
          diferentes.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving || saveDisabled}>
          {saving ? 'Salvando…' : 'Salvar preferência'}
        </Button>
      </div>
    </form>
  );
}
