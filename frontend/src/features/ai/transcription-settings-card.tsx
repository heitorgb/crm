import { useState, type FormEvent } from 'react';
import { Check, KeyRound, Loader2, Mic, PlugZap, Save, ShieldCheck } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

export function TranscriptionSettingsCard({ canManage }: { canManage: boolean }) {
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
    settings.data.updatedAt ?? 'new',
    settings.data.enabled,
    settings.data.provider,
    settings.data.model,
    settings.data.hasCredentials,
  ].join('|');

  return (
    <TranscriptionSettingsForm
      key={key}
      canManage={canManage}
      initial={settings.data}
      catalog={catalog.data}
      feedback={feedback}
      onFeedback={setFeedback}
    />
  );
}

function TranscriptionSettingsForm({
  canManage,
  initial,
  catalog,
  feedback,
  onFeedback,
}: {
  canManage: boolean;
  initial: TranscriptionSettings;
  catalog: TranscriptionCatalog;
  feedback: Feedback | null;
  onFeedback: (feedback: Feedback | null) => void;
}) {
  const saveSettings = useSaveTranscriptionSettings();
  const testConnection = useTestTranscription();

  const [enabled, setEnabled] = useState(initial.enabled);
  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState('');

  const providerDefinition =
    catalog.providers.find((item) => item.id === provider) ?? catalog.providers[0];
  const selectedModel = providerDefinition?.models.find((item) => item.id === model);
  const pending = saveSettings.isPending || testConnection.isPending;
  const hasCredential = apiKey.trim().length > 0 || initial.hasCredentials;

  const handleProviderChange = (nextProvider: AiProvider): void => {
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
        provider,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
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
          <section className="space-y-2">
            <p className="text-sm font-medium">Provedor de transcrição</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {catalog.providers.map((item) => {
                const selected = item.id === provider;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleProviderChange(item.id)}
                    aria-pressed={selected}
                    disabled={!canManage || pending || !item.supported}
                    className={cn(
                      'flex h-full min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-hover',
                      !item.supported && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                    )}
                  >
                    <AiProviderLogo provider={item.id} className="mt-0.5 size-5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {item.label}
                        {!item.supported ? <Badge variant="secondary">Sem suporte</Badge> : null}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.supported ? item.description : item.unsupportedReason}
                      </span>
                    </span>
                    {selected ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="transcription-model" label="Modelo de transcrição" required>
              <Select value={model} onValueChange={setModel} disabled={!canManage || pending}>
                <SelectTrigger id="transcription-model" aria-label="Modelo de transcrição">
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
              {selectedModel ? (
                <p className="text-xs text-muted-foreground">{selectedModel.description}</p>
              ) : null}
            </FormField>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Ativar transcrição de áudio</p>
                <p className="text-xs text-muted-foreground">
                  Desativada, a mensagem e o áudio continuam disponíveis normalmente.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canManage || pending}
                aria-label="Ativar transcrição de áudio"
              />
            </div>
          </div>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="size-4 text-muted-foreground" />
                Credencial
              </div>
              {hasCredential ? (
                <Badge variant="success">
                  <ShieldCheck />
                  Credencial OpenAI disponível
                </Badge>
              ) : (
                <Badge variant="warning">Credencial OpenAI não configurada</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A transcrição reutiliza a credencial OpenAI já salva. Nenhuma chave adicional é
              armazenada; se ela ainda não existir, informe-a abaixo.
            </p>
            <FormField
              id="transcription-api-key"
              label="Chave da API OpenAI"
              description={
                initial.hasCredentials
                  ? 'Já existe uma credencial OpenAI salva. Deixe o campo vazio para mantê-la.'
                  : 'A credencial é armazenada criptografada e nunca é exibida novamente.'
              }
            >
              <Input
                id="transcription-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={initial.hasCredentials ? '••••••••' : 'Informe a credencial'}
                autoComplete="new-password"
                disabled={!canManage || pending}
              />
            </FormField>
          </section>

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
                disabled={pending || !initial.hasCredentials}
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
