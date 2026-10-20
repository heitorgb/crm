import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, Pencil, Plug, Plus, RefreshCw, Smartphone, Trash2, Unplug } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConnectDialog } from '@/features/whatsapp/connect-dialog';
import {
  useConfigureWhatsAppWebhook,
  useConnectWhatsAppInstance,
  useDeleteWhatsAppInstance,
  useDisconnectWhatsAppInstance,
  useWhatsAppInstances,
  useWhatsAppQuota,
  whatsappKeys,
} from '@/features/whatsapp/queries';
import { useRealtime } from '@/providers/use-realtime';
import { WhatsAppInstanceForm } from '@/features/whatsapp/whatsapp-instance-form';
import { ApiError } from '@/lib/api-client';
import type {
  WhatsAppConnectionTicket,
  WhatsAppInstance,
  WhatsAppInstanceStatus,
  WhatsAppQuota,
} from '@/types/whatsapp';

const statusTone: Record<WhatsAppInstanceStatus, StatusTone> = {
  CONNECTED: 'success',
  CONNECTING: 'warning',
  DISCONNECTED: 'secondary',
  ERROR: 'danger',
};

const statusLabel: Record<WhatsAppInstanceStatus, string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando',
  DISCONNECTED: 'Desconectado',
  ERROR: 'Erro',
};

export function WhatsAppTab() {
  const query = useWhatsAppInstances({ perPage: 100 });
  const quota = useWhatsAppQuota();
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const connect = useConnectWhatsAppInstance();
  const disconnect = useDisconnectWhatsAppInstance();
  const configureWebhook = useConfigureWhatsAppWebhook();
  const deleteInstance = useDeleteWhatsAppInstance();

  useEffect(() => {
    if (!socket) {
      return;
    }
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: whatsappKeys.all });
    };
    socket.on('whatsapp.instance.updated', invalidate);
    return () => {
      socket.off('whatsapp.instance.updated', invalidate);
    };
  }, [socket, queryClient]);

  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<WhatsAppInstance | null>(null);
  const [connectState, setConnectState] = useState<{
    instance: WhatsAppInstance;
    ticket: WhatsAppConnectionTicket;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WhatsAppInstance | null>(null);
  const [limitReached, setLimitReached] = useState<WhatsAppQuota | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );

  const instances = query.data?.data ?? [];

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const handleNewInstance = async (): Promise<void> => {
    setFeedback(null);
    const result = await quota.refetch();
    const current = result.data ?? quota.data;

    if (current && !current.canCreate) {
      setLimitReached(current);
      return;
    }

    openCreate();
  };

  const openEdit = (instance: WhatsAppInstance): void => {
    setEditing(instance);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const handleConnect = async (instance: WhatsAppInstance): Promise<void> => {
    setFeedback(null);
    try {
      const ticket = await connect.mutateAsync(instance.id);
      setConnectState({ instance, ticket });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível conectar.',
      });
    }
  };

  const handleRegenerate = async (): Promise<void> => {
    if (!connectState) {
      return;
    }
    try {
      const ticket = await connect.mutateAsync(connectState.instance.id);
      setConnectState({ ...connectState, ticket });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível gerar o QR.',
      });
    }
  };

  const handleWebhook = async (instance: WhatsAppInstance): Promise<void> => {
    setFeedback(null);
    try {
      const result = await configureWebhook.mutateAsync(instance.id);
      setFeedback({ tone: 'success', message: `Webhook configurado em ${result.webhookUrl}` });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível configurar o webhook.',
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>
            Instâncias, conexão por QR code e webhook da Evolution API.
          </CardDescription>
          {quota.data && quota.data.used > 0 ? (
            <p className="text-xs text-muted-foreground">
              Instâncias cadastradas: {quota.data.used}
            </p>
          ) : null}
        </div>
        <Button onClick={() => void handleNewInstance()}>
          <Plus />
          Nova instância
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
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

        {query.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm font-medium text-danger">Não foi possível carregar as instâncias.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : instances.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhuma instância WhatsApp"
            description="Cadastre uma instância e conecte o número por QR code para começar a atender."
            action={
              <Button onClick={() => void handleNewInstance()}>
                <Plus />
                Nova instância
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instância</TableHead>
                  <TableHead className="hidden md:table-cell">Telefone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Credenciais</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((instance) => (
                  <TableRow key={instance.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{instance.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {instance.instanceName}
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {instance.phone ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={statusTone[instance.status]}>
                        {statusLabel[instance.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {instance.hasCredentials ? (
                        <StatusBadge tone="info">Configuradas</StatusBadge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Globais</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleConnect(instance)}
                          disabled={connect.isPending}
                        >
                          <Plug />
                          {instance.status === 'CONNECTED' ? 'Reconectar' : 'Conectar'}
                        </Button>
                        {instance.status === 'CONNECTED' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void disconnect.mutateAsync(instance.id)}
                            disabled={disconnect.isPending}
                            aria-label="Desconectar"
                          >
                            <Unplug />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => void handleWebhook(instance)}
                          disabled={configureWebhook.isPending}
                          aria-label="Configurar webhook"
                        >
                          <Link2 />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(instance)}
                          aria-label="Editar instância"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(instance)}
                          aria-label="Excluir instância"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          As conversas aparecem em{' '}
          <Link to="/atendimento/conversas" className="text-primary hover:underline">
            Atendimento → Conversas
          </Link>
          .
        </p>
      </CardContent>

      <WhatsAppInstanceForm
        key={formNonce}
        open={formOpen}
        onOpenChange={setFormOpen}
        instance={editing}
      />

      <Dialog
        open={Boolean(limitReached)}
        onOpenChange={(open) => {
          if (!open) setLimitReached(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Não é possível adicionar outra instância</DialogTitle>
            <DialogDescription>
              {limitReached?.used === 0
                ? 'No momento, não é possível cadastrar uma nova instância WhatsApp. Entre em contato com o suporte.'
                : limitReached?.used === 1
                  ? 'Sua organização já possui uma instância WhatsApp cadastrada. Para cadastrar uma nova, exclua a instância existente.'
                  : 'Sua organização já possui instâncias WhatsApp cadastradas. Para cadastrar uma nova, exclua uma instância existente.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setLimitReached(null)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConnectDialog
        open={Boolean(connectState)}
        onOpenChange={(open) => {
          if (!open) {
            setConnectState(null);
            void query.refetch();
          }
        }}
        instance={connectState?.instance ?? null}
        ticket={connectState?.ticket ?? null}
        regenerating={connect.isPending}
        onRegenerate={() => void handleRegenerate()}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir instância"
        description={
          pendingDelete
            ? `A instância "${pendingDelete.name}" será removida. Conversas existentes não são apagadas.`
            : undefined
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteInstance.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          void deleteInstance
            .mutateAsync(pendingDelete.id)
            .then(() => setPendingDelete(null))
            .catch(() => setPendingDelete(null));
        }}
      />
    </Card>
  );
}
