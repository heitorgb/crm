import { useState } from 'react';
import {
  Copy,
  History,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { WebhookIntegration, WebhookIntegrationWithSecret } from '@/types/webhooks';
import { buildWebhookExecuteUrl } from './services/webhooks-service';
import {
  useDeleteWebhook,
  useRegenerateWebhookSecret,
  useUpdateWebhook,
  useWebhooks,
} from './queries';
import { WebhookDetailDialog } from './webhook-detail-dialog';
import { WebhookForm } from './webhook-form';
import { WebhookSecretDialog } from './webhook-secret-dialog';

const PAGE_SIZE = 20;

export function WebhooksPage() {
  const role = useAuthStore((state) => state.session?.role);
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<WebhookIntegration | null>(null);
  const [secretWebhook, setSecretWebhook] = useState<WebhookIntegrationWithSecret | null>(null);
  const [detailWebhook, setDetailWebhook] = useState<WebhookIntegration | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookIntegration | null>(null);
  const [pendingRegenerate, setPendingRegenerate] = useState<WebhookIntegration | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );

  const debouncedSearch = useDebouncedValue(search, 350);
  const query = useWebhooks({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
  });
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const regenerateSecret = useRegenerateWebhookSecret();

  const webhooks = query.data?.data ?? [];

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const openEdit = (webhook: WebhookIntegration): void => {
    setEditing(webhook);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const toggleActive = async (webhook: WebhookIntegration, active: boolean): Promise<void> => {
    setFeedback(null);
    try {
      await updateWebhook.mutateAsync({ id: webhook.id, input: { active } });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível alterar o status.',
      });
    }
  };

  const copyUrl = async (webhook: WebhookIntegration): Promise<void> => {
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(buildWebhookExecuteUrl(webhook.id));
      setFeedback({ tone: 'success', message: 'URL de execução copiada.' });
    } catch {
      setFeedback({ tone: 'danger', message: 'Não foi possível copiar a URL.' });
    }
  };

  const confirmRegenerate = async (): Promise<void> => {
    if (!pendingRegenerate) {
      return;
    }
    setFeedback(null);
    try {
      const updated = await regenerateSecret.mutateAsync(pendingRegenerate.id);
      setPendingRegenerate(null);
      setSecretWebhook(updated);
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível gerar a credencial.',
      });
      setPendingRegenerate(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    setFeedback(null);
    try {
      await deleteWebhook.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível excluir a integração.',
      });
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Webhooks"
        description="Integrações externas para enviar mensagens de texto a grupos do WhatsApp."
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus />
              Nova integração
            </Button>
          ) : undefined
        }
      />

      {feedback ? (
        <p
          className={
            feedback.tone === 'success'
              ? 'text-xs font-medium text-success'
              : 'text-xs font-medium text-danger'
          }
        >
          {feedback.message}
        </p>
      ) : null}

      <Card className="p-4">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar por nome, grupo ou instância"
          className="sm:max-w-sm"
        />
      </Card>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-medium text-danger">
              Não foi possível carregar as integrações.
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : webhooks.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Webhook}
              title="Nenhuma integração cadastrada"
              description={
                debouncedSearch
                  ? 'Ajuste a busca para encontrar integrações.'
                  : 'Cadastre um webhook para permitir que sistemas externos enviem mensagens a um grupo.'
              }
              action={
                canManage ? (
                  <Button onClick={openCreate}>
                    <Plus />
                    Nova integração
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Instância</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook) => (
                  <TableRow key={webhook.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{webhook.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        ••••{webhook.secretHint}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{webhook.instanceName}</TableCell>
                    <TableCell>
                      <div className="text-sm">{webhook.groupName ?? 'Grupo'}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {webhook.groupJid}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={webhook.active}
                          onCheckedChange={(checked) => void toggleActive(webhook, checked)}
                          disabled={!canManage || updateWebhook.isPending}
                          aria-label={`Ativar ou desativar ${webhook.name}`}
                        />
                        <StatusBadge tone={webhook.active ? 'success' : 'secondary'}>
                          {webhook.active ? 'Ativa' : 'Inativa'}
                        </StatusBadge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Copiar URL"
                          aria-label="Copiar URL"
                          onClick={() => void copyUrl(webhook)}
                        >
                          <Copy />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Detalhes e histórico"
                          aria-label="Detalhes e histórico"
                          onClick={() => setDetailWebhook(webhook)}
                        >
                          <History />
                        </Button>
                        {canManage ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              title="Regenerar credencial"
                              aria-label="Regenerar credencial"
                              onClick={() => setPendingRegenerate(webhook)}
                            >
                              <KeyRound />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              title="Editar"
                              aria-label="Editar"
                              onClick={() => openEdit(webhook)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-danger"
                              title="Excluir"
                              aria-label="Excluir"
                              onClick={() => setPendingDelete(webhook)}
                            >
                              <Trash2 />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="border-t border-border p-4">
              <Pagination
                page={query.data.meta.page}
                pageCount={query.data.meta.totalPages}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      <WebhookForm
        key={formNonce}
        open={formOpen}
        onOpenChange={setFormOpen}
        webhook={editing}
        onCreatedWithSecret={setSecretWebhook}
      />

      <WebhookSecretDialog
        webhook={secretWebhook}
        onOpenChange={(open) => {
          if (!open) setSecretWebhook(null);
        }}
      />

      <WebhookDetailDialog
        key={detailWebhook?.id ?? 'none'}
        webhook={detailWebhook}
        executeUrl={detailWebhook ? buildWebhookExecuteUrl(detailWebhook.id) : ''}
        onOpenChange={(open) => {
          if (!open) setDetailWebhook(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingRegenerate)}
        onOpenChange={(open) => {
          if (!open) setPendingRegenerate(null);
        }}
        title="Regenerar credencial"
        description={
          pendingRegenerate
            ? `A credencial atual de "${pendingRegenerate.name}" deixará de funcionar imediatamente. A nova credencial será exibida uma única vez.`
            : undefined
        }
        confirmLabel="Regenerar"
        loading={regenerateSecret.isPending}
        onConfirm={() => void confirmRegenerate()}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir integração"
        description={
          pendingDelete
            ? `A integração "${pendingDelete.name}" será desativada e removida da listagem. O histórico de execuções é preservado internamente.`
            : undefined
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteWebhook.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
