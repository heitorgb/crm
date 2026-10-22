import { useState } from 'react';
import { KeyRound, Settings2 } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AiCatalog, AiProvider, AiSettings } from '@/types/ai';
import { AiCredentialDialog } from './ai-credential-dialog';
import { AiProviderLogo } from './ai-provider-logo';
import { useTranscriptionCatalog, useTranscriptionSettings } from './queries';

interface Feedback {
  tone: 'success' | 'danger' | 'info';
  message: string;
}

interface AiCredentialsTabProps {
  canManage: boolean;
  catalog: AiCatalog;
  settings: AiSettings;
}

export function AiCredentialsTab({ canManage, catalog, settings }: AiCredentialsTabProps) {
  const transcription = useTranscriptionSettings();
  const transcriptionCatalog = useTranscriptionCatalog();
  const [managingProvider, setManagingProvider] = useState<AiProvider | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const transcriptionProvider = transcription.data?.provider ?? null;
  const credentialPolicy = transcriptionCatalog.data?.credentialPolicy.description;
  const managingDefinition = catalog.providers.find((item) => item.id === managingProvider);
  const managingUsage = managingProvider
    ? [
        settings.provider === managingProvider ? 'Copiloto' : null,
        transcriptionProvider === managingProvider ? 'Transcrição' : null,
      ].filter((item): item is string => item !== null)
    : [];
  const managingTestModel =
    managingProvider === settings.provider
      ? settings.model
      : (managingDefinition?.models[0]?.id ?? '');

  return (
    <>
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
          {feedback ? (
            <p
              role={feedback.tone === 'danger' ? 'alert' : 'status'}
              className={cn(
                'text-xs font-medium',
                feedback.tone === 'success' && 'text-success',
                feedback.tone === 'danger' && 'text-danger',
                feedback.tone === 'info' && 'text-muted-foreground',
              )}
            >
              {feedback.message}
            </p>
          ) : null}

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
                    {canManage ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Gerenciar credencial ${provider.label}`}
                        onClick={() => {
                          setFeedback(null);
                          setManagingProvider(provider.id);
                        }}
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
              Nenhuma chave completa é exibida. Deixar o campo vazio mantém a credencial atual.
            </p>
          </div>
        </CardContent>
      </Card>

      {managingDefinition ? (
        <AiCredentialDialog
          key={managingDefinition.id}
          open
          onOpenChange={(open) => {
            if (!open) {
              setManagingProvider(null);
            }
          }}
          provider={managingDefinition.id}
          definition={managingDefinition}
          configured={settings.configuredProviders.includes(managingDefinition.id)}
          testModel={managingTestModel}
          usedBy={managingUsage}
          onRemoved={(message) => setFeedback({ tone: 'success', message })}
        />
      ) : null}
    </>
  );
}
