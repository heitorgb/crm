import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api-client';
import { usePlatformSettings, useUpdatePlatformSettings } from './queries';

export function AdminSettingsPage() {
  const query = usePlatformSettings();
  const update = useUpdatePlatformSettings();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleToggle = async (enabled: boolean): Promise<void> => {
    setError(null);
    setSuccess(null);

    try {
      await update.mutateAsync(enabled);
      setSuccess(
        enabled
          ? 'Preview de links ativado para todas as organizações.'
          : 'Preview de links desativado para todas as organizações.',
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar a configuração.');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configurações da plataforma"
        description="Configurações globais aplicadas a todas as organizações do CRM."
      />

      {query.isPending ? (
        <Card className="space-y-3 p-4">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-16 w-full" />
        </Card>
      ) : query.isError || !query.data ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium text-danger">
            Não foi possível carregar as configurações da plataforma.
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            <RefreshCw />
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Mensagens do WhatsApp</CardTitle>
            <CardDescription>
              Controla a geração de cartões de preview para links enviados pelo CRM. A alteração é
              aplicada imediatamente, sem reiniciar o sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-foreground">Gerar preview de links nas mensagens</p>
                <p className="text-sm text-muted-foreground">
                  Quando desativado, o backend envia os textos sem solicitar preview à Evolution
                  API. Quando ativado, os envios podem gerar preview conforme o suporte da versão
                  instalada.
                </p>
              </div>
              <Switch
                checked={query.data.linkPreviewsEnabled}
                onCheckedChange={(checked) => void handleToggle(checked)}
                disabled={update.isPending}
                aria-label="Gerar preview de links nas mensagens"
              />
            </div>

            {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
            {success ? <p className="text-xs font-medium text-success">{success}</p> : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
