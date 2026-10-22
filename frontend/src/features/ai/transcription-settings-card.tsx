import { useState, type FormEvent } from 'react';
import { Check, KeyRound, Loader2, Mic, PlugZap, Save } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type {
  AiProvider,
  TranscriptionCatalog,
  TranscriptionSettings,
  TranscriptionUnavailableReason,
} from '@/types/ai';
import { AiProviderLogo } from './ai-provider-logo';
import {
  useSaveTranscriptionSettings,
  useTestTranscription,
  useTranscriptionCatalog,
  useTranscriptionSettings,
} from './queries';

interface Feedback {
  tone: 'success' | 'danger' | 'info';
  message: string;
}

const REASON_LABELS: Record<TranscriptionUnavailableReason, string> = {
  disabled: 'Desativada',
  provider_unsupported: 'Provedor sem suporte',
  model_unsupported: 'Modelo incompatível',
  missing_credentials: 'Credencial ausente',
  unreadable_credentials: 'Credencial ilegível',
};

export function TranscriptionSettingsCard({
  canManage,
  onOpenCredentials,
}: {
  canManage: boolean;
  onOpenCredentials: () => void;
}) {
  const catalog = useTranscriptionCatalog();
  const settings = useTranscriptionSettings();
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (catalog.isPending || settings.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcrição de áudio</CardTitle>
          <CardDescription>Carregando a configuração de transcrição.</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (catalog.isError || settings.isError || !catalog.data || !settings.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcrição de áudio</CardTitle>
          <CardDescription>
            Transcreve áudios recebidos no WhatsApp para o atendimento e o Copiloto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-danger">
            Não foi possível carregar a configuração de transcrição.
          </p>
        </CardContent>
      </Card>
    );
  }

  const key = [
    settings.data.enabled,
    settings.data.autoEnabled,
    settings.data.provider,
    settings.data.model,
  ].join('|');

  return (
    <TranscriptionSettingsForm
      key={key}
      canManage={canManage}
      initial={settings.data}
      catalog={catalog.data}
      feedback={feedback}
      onFeedback={setFeedback}
      onOpenCredentials={onOpenCredentials}
    />
  );
}

function TranscriptionSettingsForm({
  canManage,
  initial,
  catalog,
  feedback,
  onFeedback,
  onOpenCredentials,
}: {
  canManage: boolean;
  initial: TranscriptionSettings;
  catalog: TranscriptionCatalog;
  feedback: Feedback | null;
  onFeedback: (feedback: Feedback | null) => void;
  onOpenCredentials: () => void;
}) {
  const saveSettings = useSaveTranscriptionSettings();
  const testConnection = useTestTranscription();

  const [enabled, setEnabled] = useState(initial.enabled);
  const [autoEnabled, setAutoEnabled] = useState(initial.autoEnabled);
  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [model, setModel] = useState(initial.model);

  const providerDefinition =
    catalog.providers.find((item) => item.id === provider) ?? catalog.providers[0];
  const selectedModel = providerDefinition?.models.find((item) => item.id === model);
  const pending = saveSettings.isPending || testConnection.isPending;
  const fieldsDisabled = !canManage || pending || !enabled;
  const canTest =
    canManage &&
    !pending &&
    initial.hasCredentials &&
    Boolean(model) &&
    Boolean(providerDefinition?.supported);

  const handleProviderChange = (nextProvider: AiProvider): void => {
    if (fieldsDisabled) {
      return;
    }
    const definition = catalog.providers.find((item) => item.id === nextProvider);
    if (!definition?.supported) {
      return;
    }
    setProvider(nextProvider);
    setModel(definition.models[0]?.id ?? '');
    onFeedback(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    onFeedback(null);
    try {
      await saveSettings.mutateAsync({
        enabled,
        autoEnabled,
        provider,
        model,
      });
      onFeedback({ tone: 'success', message: 'Configuração de transcrição salva.' });
    } catch (error) {
      onFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError
            ? error.message
            : 'Não foi possível salvar a configuração de transcrição.',
      });
    }
  };

  const handleTest = async (): Promise<void> => {
    onFeedback(null);
    try {
      const result = await testConnection.mutateAsync();
      onFeedback({ tone: 'success', message: result.message });
    } catch (error) {
      onFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError
            ? error.message
            : 'Não foi possível validar a credencial de transcrição.',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mic className="size-4 text-primary" />
              Transcrição de áudio
            </CardTitle>
            <CardDescription>
              Áudios recebidos no WhatsApp são transcritos em segundo plano por uma API externa.
              O provedor de texto do Copiloto não é alterado.
            </CardDescription>
          </div>
          <StatusBadge
            tone={initial.available ? 'success' : initial.enabled ? 'warning' : 'secondary'}
          >
            {initial.available
              ? 'Pronta para uso'
              : initial.enabled
                ? (REASON_LABELS[initial.reason ?? 'missing_credentials'] ?? 'Incompleta')
                : 'Desativada'}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Ativar transcrição de áudio</p>
              <p className="text-xs text-muted-foreground">
                Desativada, a mensagem e o áudio continuam disponíveis normalmente e as
                preferências salvas são mantidas.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canManage || pending}
              aria-label="Ativar transcrição de áudio"
            />
          </div>

          <section className="space-y-2">
            <p className="text-sm font-medium">Provedor de transcrição</p>
            <div className="flex flex-wrap gap-2">
              {catalog.providers.map((item) => {
                const selected = item.id === provider;
                const unavailable = fieldsDisabled || !item.supported;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleProviderChange(item.id)}
                    aria-label={`Provedor de transcrição ${item.label}`}
                    aria-pressed={selected}
                    disabled={unavailable}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      selected
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-surface-hover',
                      unavailable && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                    )}
                  >
                    <AiProviderLogo provider={item.id} className="size-4" />
                    {item.label}
                    {!item.supported ? <Badge variant="secondary">Sem suporte</Badge> : null}
                    {selected ? <Check className="size-4 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
            <FormField
              id="transcription-model"
              label="Modelo de transcrição"
              required
              description="Define o modelo usado para transcrever os áudios recebidos."
            >
              <Select
                key={provider}
                value={model}
                onValueChange={setModel}
                disabled={fieldsDisabled || !providerDefinition?.supported}
              >
                <SelectTrigger
                  id="transcription-model"
                  aria-label="Modelo de transcrição"
                  className="h-10 w-full bg-surface sm:max-w-md"
                >
                  <SelectValue placeholder="Selecione um modelo" />
                </SelectTrigger>
                <SelectContent>
                  {providerDefinition?.models.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {selectedModel ? (
              <p className="text-xs text-muted-foreground">{selectedModel.description}</p>
            ) : null}
          </section>

          <div
            className={cn(
              'flex items-center justify-between gap-4 rounded-lg border border-border p-4',
              fieldsDisabled && 'opacity-60',
            )}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">Transcrever automaticamente</p>
              <p className="text-xs text-muted-foreground">
                Desmarcada, a transcrição é solicitada manualmente em cada áudio recebido.
              </p>
            </div>
            <Switch
              checked={autoEnabled}
              onCheckedChange={setAutoEnabled}
              disabled={fieldsDisabled}
              aria-label="Transcrever automaticamente"
            />
          </div>

          {enabled && !initial.hasCredentials ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">
                Configure a credencial OpenAI para habilitar a transcrição.
              </p>
              {canManage ? (
                <Button type="button" variant="outline" size="sm" onClick={onOpenCredentials}>
                  <KeyRound />
                  Abrir credenciais
                </Button>
              ) : null}
            </div>
          ) : null}

          {!canManage ? (
            <p className="text-xs text-muted-foreground">
              Apenas proprietários e administradores podem alterar a configuração de transcrição.
            </p>
          ) : null}

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

          {canManage ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleTest()}
                disabled={!canTest}
              >
                {testConnection.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                Testar credencial
              </Button>
              <Button type="submit" disabled={pending || !model || !providerDefinition?.supported}>
                {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                Salvar transcrição
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
