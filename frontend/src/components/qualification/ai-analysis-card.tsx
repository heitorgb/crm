import type { ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Info,
  Lightbulb,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatDateTime } from '@/lib/format';
import type { QualificationAnalysis } from '@/types/qualification';
import { QualificationScore } from './qualification-score';
import { QualificationStatusBadge } from './qualification-status-badge';

interface AiAnalysisCardProps {
  analysis: QualificationAnalysis;
}

export function AiAnalysisCard({ analysis }: AiAnalysisCardProps) {
  return (
    <Card>
      <CardHeader className="gap-3 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">{analysis.leadName}</h3>
              <QualificationStatusBadge status={analysis.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              Análise concluída em {formatDateTime(analysis.completedAt)}
            </p>
          </div>
          <Badge variant="info" className="gap-1">
            <Sparkles aria-hidden />
            Gerado por IA
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-wrap items-center gap-6">
          <QualificationScore score={analysis.score} level={analysis.level} />
          <div className="min-w-[200px] flex-1 space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Resumo</p>
            <p className="text-sm text-foreground/90">{analysis.summary}</p>
          </div>
        </div>

        <Separator />

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dados coletados
          </h4>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {analysis.collectedData.map((field) => (
              <div key={field.label} className="rounded-md border border-border bg-surface px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {field.label}
                </dt>
                <dd className="text-sm font-medium text-foreground">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <AnalysisList
            title="Pontos positivos"
            icon={<CheckCircle2 className="size-4 text-success" />}
            items={analysis.strengths}
            emptyLabel="Nenhum ponto positivo registrado."
          />
          <AnalysisList
            title="Riscos e objeções"
            icon={<ShieldAlert className="size-4 text-warning" />}
            items={analysis.risks}
            emptyLabel="Nenhum risco identificado."
          />
          <AnalysisList
            title="Informações ausentes"
            icon={<Info className="size-4 text-danger" />}
            items={analysis.missing}
            emptyLabel="Nenhuma lacuna identificada."
          />
        </div>

        <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Próxima ação sugerida
            </p>
            <p className="flex items-center gap-1.5 text-sm text-foreground">
              {analysis.nextAction}
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Bot className="size-3.5" aria-hidden />
            Modelo: <span className="font-mono text-foreground/80">{analysis.model}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Info className="size-3.5" aria-hidden />
            Decisão automatizada — sujeita a revisão humana.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalysisList({
  title,
  icon,
  items,
  emptyLabel,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h4>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-foreground/90">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}
