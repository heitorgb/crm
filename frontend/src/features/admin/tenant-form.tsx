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
import { ApiError } from '@/lib/api-client';
import { useCreateTenant } from './queries';

interface TenantFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (tenantId: string) => void;
}

export function TenantForm({ open, onOpenChange, onCreated }: TenantFormProps) {
  const createTenant = useCreateTenant();
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setName('');
    setOwnerName('');
    setOwnerEmail('');
    setOwnerPassword('');
    setError(null);
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (name.trim().length === 0) {
      setError('Informe o nome da organização.');
      return;
    }
    if (ownerName.trim().length === 0) {
      setError('Informe o nome do proprietário.');
      return;
    }
    if (ownerEmail.trim().length === 0) {
      setError('Informe o e-mail do proprietário.');
      return;
    }
    if (ownerPassword.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }

    try {
      const tenant = await createTenant.mutateAsync({
        name: name.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
      });
      reset();
      onOpenChange(false);
      onCreated?.(tenant.id);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível criar a organização.',
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova organização</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField
            id="tenant-name"
            label="Nome da organização"
            required
            description="Nome exibido para seus clientes."
          >
            <Input id="tenant-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>

          <div className="grid gap-4 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Proprietário (OWNER)
            </p>
            <FormField id="tenant-owner-name" label="Nome" required>
              <Input
                id="tenant-owner-name"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
              />
            </FormField>
            <FormField id="tenant-owner-email" label="E-mail" required>
              <Input
                id="tenant-owner-email"
                type="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
              />
            </FormField>
            <FormField
              id="tenant-owner-password"
              label="Senha inicial"
              required
              description="Se o e-mail já existir, a senha atual é mantida."
            >
              <Input
                id="tenant-owner-password"
                type="password"
                autoComplete="new-password"
                value={ownerPassword}
                onChange={(event) => setOwnerPassword(event.target.value)}
              />
            </FormField>
          </div>

          {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createTenant.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={createTenant.isPending}>
            {createTenant.isPending ? <Loader2 className="animate-spin" /> : null}
            Criar organização
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
