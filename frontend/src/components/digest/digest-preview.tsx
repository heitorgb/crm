import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QualificationStatusBadge } from '@/components/qualification/qualification-status-badge';
import { formatDate } from '@/lib/format';
import type { QualificationLead } from '@/types/qualification';

interface DigestPreviewProps {
  leads: QualificationLead[];
  time: string;
  timezone: string;
}

export function DigestPreview({ leads, time, timezone }: DigestPreviewProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-primary" aria-hidden />
          Prévia do resumo
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Enviado diariamente às {time} ({timezone})
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              OU
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">OrderUp</p>
              <p className="text-[11px] text-muted-foreground">Resumo de leads qualificados</p>
            </div>
          </div>

          <p className="mb-2 text-xs text-foreground/90">
            {leads.length} {leads.length === 1 ? 'lead qualificado' : 'leads qualificados'} na janela de{' '}
            {formatDate(new Date())}:
          </p>

          <ul className="space-y-2">
            {leads.map((lead) => (
              <li key={lead.id} className="rounded-md bg-background/70 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{lead.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{lead.phone}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{lead.company}</span>
                  <span className="flex items-center gap-2">
                    {lead.score !== null ? (
                      <span className="text-xs font-semibold text-primary">{lead.score}/100</span>
                    ) : null}
                    <QualificationStatusBadge status={lead.status} showIcon={false} />
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Mensagem gerada automaticamente pelo OrderUp CRM.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
