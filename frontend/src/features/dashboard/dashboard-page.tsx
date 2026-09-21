import { useState } from 'react';
import { ArrowRight, Download, Users } from 'lucide-react';
import { DatePicker } from '@/components/common/date-picker';
import { MetricCard } from '@/components/common/metric-card';
import { PageHeader } from '@/components/common/page-header';
import { QualificationStatusBadge } from '@/components/qualification/qualification-status-badge';
import { QualificationProgress } from '@/components/qualification/qualification-progress';
import { AiAnalysisCard } from '@/components/qualification/ai-analysis-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelative } from '@/lib/format';
import { dashboardMetrics, funnelStages, latestAnalysis, recentLeads } from '@/mocks/crm';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const [period, setPeriod] = useState<Date | undefined>(new Date());
  const maxFunnel = Math.max(...funnelStages.map((stage) => stage.count));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Visão geral da operação comercial e da qualificação por IA."
        actions={
          <>
            <DatePicker value={period} onChange={setPeriod} className="w-[190px]" />
            <Button variant="outline" disabled title="Disponível em breve">
              <Download />
              Exportar
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((metric) => (
          <MetricCard
            key={metric.key}
            label={metric.label}
            value={metric.value}
            trend={metric.trend}
            hint={metric.hint}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Funil de qualificação</CardTitle>
            <Badge variant="secondary">Últimos 30 dias</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnelStages.map((stage) => (
              <div key={stage.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground/90">{stage.name}</span>
                  <span className="font-medium text-foreground">{stage.count}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      stage.tone === 'success' && 'bg-success',
                      stage.tone === 'accent' && 'bg-accent',
                      stage.tone === 'info' && 'bg-info',
                      stage.tone === 'secondary' && 'bg-muted-foreground/50',
                    )}
                    style={{ width: `${Math.round((stage.count / maxFunnel) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acompanhamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <QualificationProgress
              value={42}
              max={128}
              label="Leads qualificados"
              hint="42 de 128 leads entraram na etapa de qualificação."
            />
            <QualificationProgress
              value={9}
              max={42}
              label="Aguardando resumo"
              hint="Serão entregues no próximo digest agendado."
            />
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
              <Users className="size-4 text-primary" aria-hidden />
              <span>O bot atendeu 64 conversas nas últimas 24 horas.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Leads recentes</TabsTrigger>
          <TabsTrigger value="analysis">Análise de IA</TabsTrigger>
        </TabsList>

        <TabsContent value="leads">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Leads recentes</CardTitle>
              <Button variant="ghost" size="sm" disabled title="Disponível em breve">
                Ver todos
                <ArrowRight />
              </Button>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead className="hidden md:table-cell">Telefone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Atualizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLeads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{lead.name}</div>
                        <div className="text-xs text-muted-foreground">{lead.company}</div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">
                        {lead.phone}
                      </TableCell>
                      <TableCell>
                        <QualificationStatusBadge status={lead.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {lead.score !== null ? `${lead.score}/100` : '—'}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                        {formatRelative(lead.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis">
          <AiAnalysisCard analysis={latestAnalysis} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
