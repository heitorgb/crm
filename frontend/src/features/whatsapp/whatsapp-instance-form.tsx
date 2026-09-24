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
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api-client';
import type { WhatsAppInstance } from '@/types/whatsapp';
import { useCreateWhatsAppInstance, useUpdateWhatsAppInstance } from './queries';

interface WhatsAppInstanceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance?: WhatsAppInstance | null;
}

export function WhatsAppInstanceForm({ open, onOpenChange, instance }: WhatsAppInstanceFormProps) {
  const createInstance = useCreateWhatsAppInstance();
  const updateInstance = useUpdateWhatsAppInstance();

  const [name, setName] = useState(instance?.name ?? '');
  const [instanceName, setInstanceName] = useState(instance?.instanceName ?? '');
  const [phone, setPhone] = useState(instance?.phone ?? '');
  const [active, setActive] = useState(instance?.active ?? true);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pending = createInstance.isPending || updateInstance.isPending;

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (name.trim().length === 0) {
      setError('Informe um nome para a instância.');
      return;
    }
    if (!instance && instanceName.trim().length === 0) {
      setError('Informe o instanceName usado na Evolution API.');
      return;
    }

    const credentials =
      apiKey.trim().length > 0 || webhookSecret.trim().length > 0
        ? {
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
          }
        : undefined;

    try {
      if (instance) {
        await updateInstance.mutateAsync({
          id: instance.id,
          input: {
            name: name.trim(),
            phone: phone.trim() || null,
            active,
            ...(credentials ? { credentials } : {}),
          },
        });
      } else {
        await createInstance.mutateAsync({
          name: name.trim(),
          instanceName: instanceName.trim(),
          phone: phone.trim() || null,
          active,
          ...(credentials ? { credentials } : {}),
        });
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível salvar a instância.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{instance ? 'Editar instância' : 'Nova instância WhatsApp'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="wa-name" label="Nome" required>
              <Input id="wa-name" value={name} onChange={(event) => setName(event.target.value)} />
            </FormField>
            <FormField
              id="wa-instance"
              label="instanceName"
              required
              description="Nome usado na Evolution API."
            >
              <Input
                id="wa-instance"
                value={instanceName}
                onChange={(event) => setInstanceName(event.target.value)}
                disabled={Boolean(instance)}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="wa-phone" label="Telefone">
              <Input
                id="wa-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+55 11 99999-9999"
              />
            </FormField>
            <div className="flex items-end">
              <div className="flex w-full items-center justify-between rounded-md border border-border p-3">
                <span className="text-sm">Ativa</span>
                <Switch checked={active} onCheckedChange={setActive} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="wa-apikey"
              label="API key da instância"
              description="Opcional; não é exibida depois de salva."
            >
              <Input
                id="wa-apikey"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={instance?.hasCredentials ? '•••• (manter)' : ''}
              />
            </FormField>
            <FormField
              id="wa-secret"
              label="Segredo do webhook"
              description="Opcional; usa o segredo global quando vazio."
            >
              <Input
                id="wa-secret"
                type="password"
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
              />
            </FormField>
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
