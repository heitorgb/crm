import { KeyRound, Settings2 } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { AiCatalog, AiSettings } from '@/types/ai';
import { AiProviderLogo } from './ai-provider-logo';
import { useTranscriptionCatalog, useTranscriptionSettings } from './queries';

interface AiCredentialsTabProps {
  canManage: boolean;
  catalog: AiCatalog;
  settings: AiSettings;
  onManage: (section: 'copilot' | 'transcription') => void;
}

export function AiCredentialsTab({
  canManage,
  catalog,
  settings,
  onManage,
}: AiCredentialsTabProps) {
  const transcription = useTranscriptionSettings();
  const transcriptionCatalog = useTranscriptionCatalog();
  const transcriptionProvider = transcription.data?.provider ?? null;
  const credentialPolicy = transcriptionCatalog.data?.credentialPolicy.description;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              Credenciais de IA
            </CardTitle>
            <CardDescription>
              Status das credenciais por provedor e pelos recursos que as utilizam. As chaves são
              armazenadas criptografadas e nunca são exibidas.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {transcription.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="space-y-2">
            {catalog.providers.map((provider) => {
              const configured = settings.configuredProviders.includes(provider.id);
              const usedByCopilot = settings.provider === provider.id;
              const usedByTranscription = transcriptionProvider === provider.id;

              return (
                <div
                  key={provider.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <AiProviderLogo provider={provider.id} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{provider.label}</p>
                      {usedByCopilot || usedByTranscription ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {usedByCopilot ? <Badge variant="secondary">Copiloto</Badge> : null}
                          {usedByTranscription ? (
                            <Badge variant="secondary">Transcrição</Badge>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={configured ? 'success' : 'secondary'}>
                      {configured ? 'Configurada' : 'Não configurada'}
                    </StatusBadge>
                    {canManage && (usedByCopilot || usedByTranscription) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Gerenciar credencial ${provider.label}`}
                        onClick={() => onManage(usedByCopilot ? 'copilot' : 'transcription')}
                      >
                        <Settings2 />
                        Gerenciar
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {transcription.isError ? (
          <p className="text-xs font-medium text-danger">
            Não foi possível carregar o status das credenciais de transcrição.
          </p>
        ) : null}

        <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p>
            As credenciais são independentes por provedor. A transcrição reutiliza a credencial
            OpenAI já salva para o Copiloto.
          </p>
          {credentialPolicy ? <p>{credentialPolicy}</p> : null}
          <p>
            Para adicionar, substituir ou remover uma chave, abra a sub-aba do recurso
            correspondente. Nenhuma chave completa é exibida nesta tela.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
