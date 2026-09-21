import { useState } from 'react';
import { CalendarClock, Info } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { DigestPreview } from '@/components/digest/digest-preview';
import { DigestScheduleForm } from '@/components/digest/digest-schedule-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { digestLeads } from '@/mocks/crm';
import type { DigestSettings } from '@/types/qualification';

const initialSettings: DigestSettings = {
  enabled: true,
  time: '18:00',
  timezone: 'America/Sao_Paulo',
  channel: 'whatsapp',
};

export function LeadDigestPage() {
  const [settings, setSettings] = useState<DigestSettings>(initialSettings);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Resumo de Leads"
        description="Defina quando e como você recebe os leads qualificados em lote."
        actions={
          <Badge variant={settings.enabled ? 'success' : 'secondary'} className="gap-1">
            <CalendarClock aria-hidden />
            {settings.enabled ? 'Ativo' : 'Desativado'}
          </Badge>
        }
      />

      <div className="flex items-start gap-2 rounded-md border border-info/20 bg-info/5 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
        <p>
          A preferência pertence à sua membership. A persistência será conectada quando o módulo de
          digest estiver disponível; a prévia abaixo reflete os ajustes em tempo real.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Agendamento</CardTitle>
          </CardHeader>
          <CardContent>
            <DigestScheduleForm
              value={settings}
              onChange={setSettings}
              onSubmit={() => undefined}
              saveDisabled
            />
          </CardContent>
        </Card>

        <DigestPreview
          leads={digestLeads}
          time={settings.time}
          timezone={settings.timezone}
        />
      </div>
    </div>
  );
}
