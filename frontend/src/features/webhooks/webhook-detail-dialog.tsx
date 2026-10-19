import { useState } from 'react';
import { Check, Copy, ExternalLink, History } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Pagination } from '@/components/common/pagination';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { WebhookExecutionStatus, WebhookIntegration } from '@/types/webhooks';
import { useWebhookExecutions } from './queries';

const PAGE_SIZE = 10;

const statusTone: Record<WebhookExecutionStatus, StatusTone> = {
  SUCCESS: 'success',
  PROCESSING: 'warning',
  FAILED: 'danger',
};

const statusLabel: Record<WebhookExecutionStatus, string> = {
  SUCCESS: 'Enviado',
  PROCESSING: 'Processando',
  FAILED: 'Falhou',
};

interface WebhookDetailDialogProps {
  webhook: WebhookIntegration | null;
  executeUrl: string;
  onOpenChange: (open: boolean) => void;
}

export function WebhookDetailDialog({
  webhook,
  executeUrl,
  onOpenChange,
}: WebhookDetailDialogProps) {
  const [page, setPage] = useState(1);
  const executions = useWebhookExecutions(webhook?.id, { page, perPage: PAGE_SIZE });
  const [copied, setCopied] = useState<string | null>(null);

  const payload = JSON.stringify({ message: 'Olá! Mensagem enviada pelo sistema externo.' }, null, 2);
  const curl = [
    `curl -X POST '${executeUrl}' \\`,
    `  -H 'Authorization: Bearer <credencial>' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"message":"Olá! Mensagem enviada pelo sistema externo."}'`,
  ].join('\n');

  const copy = async (label: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Dialog open={Boolean(webhook)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{webhook?.name ?? 'Integração'}</DialogTitle>
          <DialogDescription>
            {webhook?.groupName ?? webhook?.groupJid ?? ''} · {webhook?.instanceName ?? ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">URL de execução</h3>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                {executeUrl}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copy('url', executeUrl)}
                aria-label="Copiar URL"
              >
                {copied === 'url' ? <Check className="text-success" /> : <Copy />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Autentique com <code>Authorization: Bearer &lt;credencial&gt;</code> ou{' '}
              <code>x-webhook-secret</code>. A instância e o grupo são sempre resolvidos pela
              integração; o corpo aceita apenas <code>message</code>.
            </p>
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Payload JSON</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copy('payload', payload)}
                >
                  {copied === 'payload' ? <Check className="text-success" /> : <Copy />}
                  Copiar
                </Button>
              </div>
              <pre className="overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
                {payload}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Exemplo cURL</h3>
                <Button variant="ghost" size="sm" onClick={() => void copy('curl', curl)}>
                  {copied === 'curl' ? <Check className="text-success" /> : <Copy />}
                  Copiar
                </Button>
              </div>
              <pre className="overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
                {curl}
              </pre>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4" />
              Histórico de execuções
            </h3>

            {executions.isPending ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-full" />
                ))}
              </div>
            ) : executions.isError ? (
              <p className="text-xs font-medium text-danger">
                Não foi possível carregar o histórico de execuções.
              </p>
            ) : executions.data.data.length === 0 ? (
              <EmptyState
                icon={ExternalLink}
                title="Nenhuma execução"
                description="As chamadas externas aparecerão aqui com o status do envio."
              />
            ) : (
              <>
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Mensagem externa</TableHead>
                        <TableHead>Erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executions.data.data.map((execution) => (
                        <TableRow key={execution.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatDateTime(execution.createdAt)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone={statusTone[execution.status]}>
                              {statusLabel[execution.status]}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {execution.externalMessageId ?? '—'}
                          </TableCell>
                          <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                            {execution.errorMessage ?? execution.errorCode ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Pagination
                  page={executions.data.meta.page}
                  pageCount={executions.data.meta.totalPages}
                  onPageChange={setPage}
                />
              </>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
