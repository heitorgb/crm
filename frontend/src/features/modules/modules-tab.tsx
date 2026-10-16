import { useState } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api-client';
import type { TenantModuleEntry } from '@/types/modules';
import { useTenantModules, useUpdateTenantModule } from './queries';

interface ModulesTabProps {
  tenantId: string;
}

export function ModulesTab({ tenantId }: ModulesTabProps) {
  const query = useTenantModules(tenantId);
  const update = useUpdateTenantModule(tenantId);

  const [pending, setPending] = useState<TenantModuleEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const confirmToggle = async (): Promise<void> => {
    if (!pending) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const updated = await update.mutateAsync({
        moduleKey: pending.key,
        enabled: !pending.enabled,
      });
      setSuccess(
        updated.enabled
          ? `Módulo "${updated.name}" ativado para esta organização.`
          : `Módulo "${updated.name}" desativado para esta organização.`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível alterar o módulo.');
    } finally {
      setPending(null);
    }
  };

  if (query.isPending) {
    return (
      <Card className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-medium text-danger">Não foi possível carregar os módulos.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          <RefreshCw />
          Tentar novamente
        </Button>
      </Card>
    );
  }

  if (!query.data || query.data.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={Package}
          title="Nenhum módulo cadastrado"
          description="O catálogo de módulos está vazio."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
      {success ? <p className="text-xs font-medium text-success">{success}</p> : null}

      <Card className="divide-y divide-border">
        {query.data.map((module) => (
          <div
            key={module.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">{module.name}</p>
                {module.category ? (
                  <StatusBadge tone="secondary">{module.category}</StatusBadge>
                ) : null}
                <StatusBadge tone={module.enabled ? 'success' : 'danger'}>
                  {module.enabled ? 'Ativo' : 'Inativo'}
                </StatusBadge>
              </div>
              {module.description ? (
                <p className="mt-1 text-xs text-muted-foreground">{module.description}</p>
              ) : null}
              <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {module.key}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!module.controllable ? (
                <span className="text-xs text-muted-foreground">Sempre ativo</span>
              ) : null}
              <Switch
                checked={module.enabled}
                onCheckedChange={() => setPending(module)}
                disabled={update.isPending || !module.controllable}
                aria-label={`Ativar ou desativar ${module.name}`}
              />
            </div>
          </div>
        ))}
      </Card>

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={pending?.enabled ? 'Desativar módulo' : 'Ativar módulo'}
        description={
          pending
            ? pending.enabled
              ? `O módulo "${pending.name}" deixará de aparecer e de funcionar para esta organização. Os dados existentes são preservados.`
              : `O módulo "${pending.name}" voltará a ficar disponível para esta organização.`
            : undefined
        }
        confirmLabel={pending?.enabled ? 'Desativar' : 'Ativar'}
        destructive={Boolean(pending?.enabled)}
        loading={update.isPending}
        onConfirm={() => void confirmToggle()}
      />
    </div>
  );
}
