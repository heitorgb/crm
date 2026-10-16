import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Smartphone } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { FormField } from '@/components/common/form-field';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import type { WhatsAppInstanceStatus } from '@/types/attendance';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import { useStartConversation } from './queries';

const statusLabel: Record<WhatsAppInstanceStatus, string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando',
  DISCONNECTED: 'Desconectado',
  ERROR: 'Erro',
};

const statusTone: Record<WhatsAppInstanceStatus, StatusTone> = {
  CONNECTED: 'success',
  CONNECTING: 'warning',
  DISCONNECTED: 'secondary',
  ERROR: 'danger',
};

interface StartConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: { id: string; name: string } | null;
}

export function StartConversationDialog({
  open,
  onOpenChange,
  contact,
}: StartConversationDialogProps) {
  const navigate = useNavigate();
  const instancesQuery = useWhatsAppInstances({ perPage: 100 });
  const startConversation = useStartConversation();

  const [instanceId, setInstanceId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const instances = instancesQuery.data?.data ?? [];
  const selectedId =
    instanceId ||
    instances.find((instance) => instance.status === 'CONNECTED')?.id ||
    instances[0]?.id ||
    '';
  const selected = instances.find((instance) => instance.id === selectedId);

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setInstanceId('');
      setError(null);
    }
    onOpenChange(next);
  };

  const handleStart = async (): Promise<void> => {
    if (!contact) {
      return;
    }
    if (!selectedId) {
      setError('Selecione um WhatsApp para iniciar a conversa.');
      return;
    }

    setError(null);
    try {
      const conversation = await startConversation.mutateAsync({
        contactId: contact.id,
        whatsappInstanceId: selectedId,
      });
      handleOpenChange(false);
      navigate(`/atendimento/conversas?conversation=${conversation.id}`);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível iniciar a conversa.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Iniciar atendimento</DialogTitle>
        </DialogHeader>

        {instancesQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando WhatsApps…</p>
        ) : instances.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhum WhatsApp conectado"
            description="Conecte um número para iniciar um atendimento."
            action={
              <Button asChild onClick={() => handleOpenChange(false)}>
                <Link to="/configuracoes?tab=whatsapp">Conectar WhatsApp</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {contact
                ? `A conversa com ${contact.name} será criada (ou retomada) e aberta no atendimento.`
                : 'Selecione o WhatsApp que fará o contato.'}
            </p>

            <FormField id="start-instance" label="Enviar como">
              <Select value={selectedId} onValueChange={setInstanceId}>
                <SelectTrigger id="start-instance" aria-label="WhatsApp de envio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      {instance.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {selected ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{selected.instanceName}</span>
                <StatusBadge tone={statusTone[selected.status]}>
                  {statusLabel[selected.status]}
                </StatusBadge>
              </div>
            ) : null}

            {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={startConversation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => void handleStart()}
            disabled={startConversation.isPending || instances.length === 0}
          >
            {startConversation.isPending ? <Loader2 className="animate-spin" /> : null}
            Iniciar conversa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
