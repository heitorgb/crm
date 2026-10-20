import { useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { useAdminTenant, useUpdateTenantWhatsAppLimit } from './queries';

interface WhatsAppLimitTabProps {
  tenantId: string;
}

export function WhatsAppLimitTab({ tenantId }: WhatsAppLimitTabProps) {
  const query = useAdminTenant(tenantId);

  if (query.isPending) {
    return (
      <Card className="space-y-3 p-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-10 w-full max-w-xs" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-medium text-danger">Não foi possível carregar o limite.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          <RefreshCw />
          Tentar novamente
        </Button>
      </Card>
    );
  }

  return (
    <WhatsAppLimitEditor
      tenantId={tenantId}
      limit={query.data.whatsappInstanceLimit}
      used={query.data.whatsappInstancesUsed}
    />
  );
}

interface WhatsAppLimitEditorProps {
  tenantId: string;
  limit: number;
  used: number;
}

function WhatsAppLimitEditor({ tenantId, limit, used }: WhatsAppLimitEditorProps) {
  const update = useUpdateTenantWhatsAppLimit(tenantId);

  const [value, setValue] = useState(String(limit));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const available = Math.max(0, limit - used);
  const overLimit = used > limit;

  const handleSave = async (): Promise<void> => {
    setError(null);
    setSuccess(null);

    if (value.trim().length === 0) {
      setError('Informe o limite de instâncias WhatsApp.');
      return;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError('O limite deve ser um número inteiro maior ou igual a zero.');
      return;
    }

    try {
      await update.mutateAsync(parsed);
      setSuccess('Limite atualizado com sucesso.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar o limite.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Limites e recursos</CardTitle>
        <CardDescription>
          Defina quantas instâncias WhatsApp esta organização pode cadastrar. Instâncias
          desconectadas também ocupam uma vaga.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField
            id="whatsapp-instance-limit"
            label="Limite de instâncias WhatsApp"
            description="Use 0 para bloquear novos cadastros."
            className="w-full sm:max-w-xs"
          >
            <div className="flex items-center gap-2">
              <Input
                id="whatsapp-instance-limit"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <span className="whitespace-nowrap text-sm text-muted-foreground">instâncias</span>
            </div>
          </FormField>
          <Button onClick={() => void handleSave()} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Salvar
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Utilizadas</p>
            <p className="text-lg font-semibold text-foreground">
              {used} de {limit}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Disponíveis</p>
            <p className="text-lg font-semibold text-foreground">{available}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Limite configurado</p>
            <p className="text-lg font-semibold text-foreground">{limit}</p>
          </div>
        </div>

        {overLimit ? (
          <p className="text-xs font-medium text-warning">
            A organização está acima do limite configurado. As instâncias existentes foram
            mantidas, mas novos cadastros estão bloqueados. Exclua instâncias ou aumente o limite.
          </p>
        ) : null}

        {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        {success ? <p className="text-xs font-medium text-success">{success}</p> : null}
      </CardContent>
    </Card>
  );
}
