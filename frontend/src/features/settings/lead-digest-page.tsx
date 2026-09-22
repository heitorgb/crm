import { useState } from 'react';
import { CalendarClock, CheckCircle2, ListChecks, PlayCircle, TriangleAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { FormField } from '@/components/common/form-field';
import { PageHeader } from '@/components/common/page-header';
import { PageLoader } from '@/components/common/page-loader';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';
import type {
  DigestChannel,
  DigestDelivery,
  DigestPreference,
  DigestStatus,
} from '@/types/attendance';
import {
  useDigestDeliveries,
  useDigestOverview,
  useDigestPreference,
  useRunDigest,
  useUpsertDigestPreference,
} from '@/features/digest/queries';

const TIME_ZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Bahia',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Porto_Velho',
  'Europe/Lisbon',
  'UTC',
];

const channelLabels: Record<DigestChannel, string> = {
  INTERNAL: 'No CRM (sempre disponível)',
  WHATSAPP: 'WhatsApp do responsável',
  EMAIL: 'E-mail (não suportado ainda)',
};

const deliveryTone: Record<DigestStatus, StatusTone> = {
  PENDING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'secondary',
};

export function LeadDigestPage() {
  const preferenceQuery = useDigestPreference();
  const canManage = useAuthStore((state) => state.hasRole('OWNER', 'ADMIN'));
  const runDigest = useRunDigest();

  if (preferenceQuery.isPending) {
    return <PageLoader label="Carregando preferências do resumo…" />;
  }

  const preference = preferenceQuery.data ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Resumo de Leads"
        description="Configure o resumo diário em lote dos leads qualificados."
        actions={
          <>
            <Badge variant={preference?.enabled ? 'success' : 'secondary'} className="gap-1">
              <CalendarClock aria-hidden />
              {preference?.enabled ? 'Ativo' : 'Desativado'}
            </Badge>
            {canManage ? (
              <Button
                variant="outline"
                onClick={() => void runDigest.mutateAsync()}
                disabled={runDigest.isPending}
              >
                <PlayCircle />
                Executar agora
              </Button>
            ) : null}
          </>
        }
      />

      <DigestPreferenceForm
        key={preference?.updatedAt ?? 'new'}
        preference={preference}
        canManage={canManage}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <PendingLeadsCard />
        <NeedsHumanCard />
      </div>

      <DeliveriesCard />
    </div>
  );
}

function DigestPreferenceForm({
  preference,
  canManage,
}: {
  preference: DigestPreference | null;
  canManage: boolean;
}) {
  const upsert = useUpsertDigestPreference();
  const [enabled, setEnabled] = useState(preference?.enabled ?? true);
  const [deliveryTime, setDeliveryTime] = useState(preference?.deliveryTime ?? '09:00');
  const [timeZone, setTimeZone] = useState(preference?.timeZone ?? 'America/Sao_Paulo');
  const [channel, setChannel] = useState<DigestChannel>(preference?.channel ?? 'INTERNAL');
  const [whatsappDestination, setWhatsappDestination] = useState(
    preference?.whatsappDestination ?? '',
  );
  const [includeOnlyAssigned, setIncludeOnlyAssigned] = useState(
    preference?.includeOnlyAssigned ?? false,
  );
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );

  const save = async (): Promise<void> => {
    setFeedback(null);
    try {
      await upsert.mutateAsync({
        enabled,
        deliveryTime,
        timeZone,
        channel,
        whatsappDestination: whatsappDestination.trim() || null,
        includeOnlyAssigned,
      });
      setFeedback({ tone: 'success', message: 'Preferências salvas.' });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível salvar.',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferências do resumo</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <span className="text-sm">Receber resumo diário</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canManage} />
        </div>

        <FormField id="digest-time" label="Horário (fuso local)">
          <Input
            id="digest-time"
            type="time"
            value={deliveryTime}
            onChange={(event) => setDeliveryTime(event.target.value)}
            disabled={!canManage}
          />
        </FormField>

        <FormField id="digest-zone" label="Fuso horário">
          <Select value={timeZone} onValueChange={setTimeZone} disabled={!canManage}>
            <SelectTrigger id="digest-zone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_ZONES.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField id="digest-channel" label="Canal de entrega">
          <Select
            value={channel}
            onValueChange={(value) => setChannel(value as DigestChannel)}
            disabled={!canManage}
          >
            <SelectTrigger id="digest-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(channelLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {channel === 'WHATSAPP' ? (
          <FormField
            id="digest-destination"
            label="WhatsApp do responsável"
            description="Nunca use o número do lead como destino."
            className="md:col-span-2"
          >
            <Input
              id="digest-destination"
              value={whatsappDestination}
              onChange={(event) => setWhatsappDestination(event.target.value)}
              placeholder="+55 11 99999-9999"
              disabled={!canManage}
            />
          </FormField>
        ) : null}

        <div className="flex items-center justify-between rounded-md border border-border p-3 md:col-span-2">
          <span className="text-sm">Somente leads atribuídos a mim</span>
          <Switch
            checked={includeOnlyAssigned}
            onCheckedChange={setIncludeOnlyAssigned}
            disabled={!canManage}
          />
        </div>

        {feedback ? (
          <p
            className={
              feedback.tone === 'success'
                ? 'text-xs font-medium text-success md:col-span-2'
                : 'text-xs font-medium text-danger md:col-span-2'
            }
          >
            {feedback.message}
          </p>
        ) : null}

        <div className="md:col-span-2">
          <Button onClick={() => void save()} disabled={!canManage || upsert.isPending}>
            Salvar preferências
          </Button>
          {!canManage ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Apenas OWNER e ADMIN podem alterar o resumo.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PendingLeadsCard() {
  const overview = useDigestOverview();
  const pending = overview.data?.awaitingDigest ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" aria-hidden />
          Leads aguardando resumo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lead aguardando entrega.</p>
        ) : (
          pending.map((lead) => (
            <div key={lead.leadId} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {lead.name ?? lead.phone ?? 'Lead'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {lead.score !== null ? `${lead.score}/100` : '—'} ·{' '}
                  {lead.qualificationLevel ?? 'n/d'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{lead.summary}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function NeedsHumanCard() {
  const overview = useDigestOverview();
  const needsHuman = overview.data?.needsHuman ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-warning" aria-hidden />
          Exceções que precisam de humano
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : needsHuman.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            Nenhuma exceção pendente.
          </div>
        ) : (
          needsHuman.map((item) => (
            <div
              key={item.conversationId}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <span className="text-sm">{item.leadName ?? 'Lead sem nome'}</span>
              <StatusBadge tone="warning">Handoff</StatusBadge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function DeliveriesCard() {
  const deliveriesQuery = useDigestDeliveries({ perPage: 20 });

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Histórico de entregas</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {deliveriesQuery.isPending ? (
          <div className="space-y-2 px-4 pb-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (deliveriesQuery.data?.data.length ?? 0) === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState
              icon={CalendarClock}
              title="Nenhuma entrega realizada"
              description="As execuções do resumo aparecem aqui."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Canal</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead className="hidden md:table-cell">Entregue em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveriesQuery.data?.data.map((delivery: DigestDelivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="text-xs">
                    {formatDateTime(delivery.periodStart)} → {formatDateTime(delivery.periodEnd)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={deliveryTone[delivery.status]}>
                      {delivery.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="hidden text-xs sm:table-cell">{delivery.channel}</TableCell>
                  <TableCell>{delivery.leadCount}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {delivery.deliveredAt ? formatDateTime(delivery.deliveredAt) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
