import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import { ApiError } from '@/lib/api-client';
import type { WebhookIntegration, WebhookIntegrationWithSecret } from '@/types/webhooks';
import { useCreateWebhook, useUpdateWebhook, useWebhookGroups } from './queries';

interface WebhookFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhook?: WebhookIntegration | null;
  onCreatedWithSecret: (webhook: WebhookIntegrationWithSecret) => void;
}

export function WebhookForm({ open, onOpenChange, webhook, onCreatedWithSecret }: WebhookFormProps) {
  const instances = useWhatsAppInstances({ perPage: 100, active: true });
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();

  const [name, setName] = useState(webhook?.name ?? '');
  const [whatsappInstanceId, setWhatsappInstanceId] = useState(
    webhook?.whatsappInstanceId ?? '',
  );
  const [groupJid, setGroupJid] = useState(webhook?.groupJid ?? '');
  const [active, setActive] = useState(webhook?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const groups = useWebhookGroups(whatsappInstanceId || undefined);
  const pending = createWebhook.isPending || updateWebhook.isPending;

  const instanceOptions = (instances.data?.data ?? []).filter(
    (instance) =>
      instance.status === 'CONNECTED' || instance.id === webhook?.whatsappInstanceId,
  );

  const groupOptions = [...(groups.data ?? [])];
  if (
    webhook?.groupJid === groupJid &&
    groupJid &&
    !groupOptions.some((group) => group.jid === groupJid)
  ) {
    groupOptions.unshift({ jid: groupJid, name: webhook.groupName, size: null });
  }

  const handleInstanceChange = (value: string): void => {
    setWhatsappInstanceId(value);
    setGroupJid('');
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (name.trim().length === 0) {
      setError('Informe um nome para a integração.');
      return;
    }
    if (!whatsappInstanceId) {
      setError('Selecione a instância do WhatsApp remetente.');
      return;
    }
    if (!groupJid) {
      setError('Selecione o grupo destinatário.');
      return;
    }

    try {
      if (webhook) {
        await updateWebhook.mutateAsync({
          id: webhook.id,
          input: {
            name: name.trim(),
            whatsappInstanceId,
            groupJid,
            active,
          },
        });
        onOpenChange(false);
      } else {
        const created = await createWebhook.mutateAsync({
          name: name.trim(),
          whatsappInstanceId,
          groupJid,
          active,
        });
        onOpenChange(false);
        onCreatedWithSecret(created);
      }
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível salvar a integração.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{webhook ? 'Editar integração' : 'Nova integração de webhook'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="webhook-name" label="Nome" required>
            <Input
              id="webhook-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Notificações do sistema"
            />
          </FormField>

          <FormField
            id="webhook-instance"
            label="Instância do WhatsApp"
            required
            description="Somente instâncias conectadas podem listar grupos."
          >
            <Select value={whatsappInstanceId} onValueChange={handleInstanceChange}>
              <SelectTrigger id="webhook-instance">
                <SelectValue placeholder="Selecione a instância" />
              </SelectTrigger>
              <SelectContent>
                {instanceOptions.map((instance) => (
                  <SelectItem key={instance.id} value={instance.id}>
                    {instance.name} · {instance.instanceName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            id="webhook-group"
            label="Grupo destinatário"
            required
            description="O grupo é resolvido pela instância e nunca pelo corpo da chamada externa."
            error={
              groups.isError
                ? 'Não foi possível listar os grupos desta instância.'
                : undefined
            }
          >
            <Select
              value={groupJid}
              onValueChange={setGroupJid}
              disabled={!whatsappInstanceId || groups.isPending}
            >
              <SelectTrigger id="webhook-group">
                <SelectValue
                  placeholder={
                    groups.isPending && whatsappInstanceId
                      ? 'Carregando grupos...'
                      : 'Selecione o grupo'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {groupOptions.map((group) => (
                  <SelectItem key={group.jid} value={group.jid}>
                    {group.name ?? group.jid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Integração ativa</p>
              <p className="text-xs text-muted-foreground">
                Integrações inativas recusam novas execuções externas.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
