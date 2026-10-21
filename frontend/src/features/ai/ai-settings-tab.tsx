import { useState, type FormEvent } from 'react';
import {
  Check,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
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
  AiCatalog,
  AiFormality,
  AiProvider,
  AiSettings,
  UpdateAiSettingsInput,
} from '@/types/ai';
import { AiProviderLogo } from './ai-provider-logo';
import { useAiCatalog, useAiSettings, useSaveAiSettings, useTestAiConnection } from './queries';

interface Feedback {
  tone: 'success' | 'danger' | 'info';
  message: string;
}

interface AiSettingsTabProps {
  canManage: boolean;
}

export function AiSettingsTab({ canManage }: AiSettingsTabProps) {
  const catalog = useAiCatalog();
  const settings = useAiSettings();
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (catalog.isPending || settings.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inteligência Artificial</CardTitle>
          <CardDescription>Carregando as configurações de IA.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-9 w-full max-w-sm" />
        </CardContent>
      </Card>
    );
  }

  if (catalog.isError || settings.isError || !catalog.data || !settings.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inteligência Artificial</CardTitle>
          <CardDescription>
            A IA auxilia na redação das mensagens enviadas pelo atendimento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-danger">Não foi possível carregar as configurações de IA.</p>
        </CardContent>
      </Card>
    );
  }

  const key = [
    settings.data.updatedAt ?? 'new',
    settings.data.provider,
    settings.data.model,
    settings.data.formality,
    settings.data.enabled,
    settings.data.hasCredentials,
    settings.data.configuredProviders.join(','),
  ].join('|');

  return (
    <AiSettingsForm
      key={key}
      canManage={canManage}
      initial={settings.data}
      catalog={catalog.data}
      feedback={feedback}
      onFeedback={setFeedback}
    />
  );
}

function AiSettingsForm({
  canManage,
  initial,
  catalog,
  feedback,
  onFeedback,
}: {
  canManage: boolean;
  initial: AiSettings;
  catalog: AiCatalog;
  feedback: Feedback | null;
  onFeedback: (feedback: Feedback | null) => void;
}) {
  const saveSettings = useSaveAiSettings();
  const testConnection = useTestAiConnection();

  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [formality, setFormality] = useState<AiFormality>(initial.formality);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [apiKey, setApiKey] = useState('');
  const [clearCredentials, setClearCredentials] = useState(false);

  const providerDefinition =
    catalog.providers.find((item) => item.id === provider) ?? catalog.providers[0];
  const selectedModel = providerDefinition.models.find((item) => item.id === model);
  const credentialConfigured = initial.configuredProviders.includes(provider);
  const hasCredential = apiKey.trim().length > 0 || (credentialConfigured && !clearCredentials);
  const canTest =
    canManage && !saveSettings.isPending && !testConnection.isPending && hasCredential;
  const pending = saveSettings.isPending || testConnection.isPending;

  const handleProviderChange = (nextProvider: AiProvider): void => {
    const definition = catalog.providers.find((item) => item.id === nextProvider);
    if (!definition) {
      return;
    }
    setProvider(nextProvider);
    setModel(definition.models[0]?.id ?? '');
    setApiKey('');
    setClearCredentials(false);
    onFeedback(null);
  };

  const buildInput = (): UpdateAiSettingsInput => {
    const input: UpdateAiSettingsInput = {
      provider,
      model,
      formality,
      enabled,
    };

    if (apiKey.trim().length > 0) {
      input.apiKey = apiKey.trim();
    }
    if (clearCredentials) {
      input.clearCredentials = true;
    }

    return input;
  };

  const handleTest = async (): Promise<void> => {
    onFeedback(null);
    try {
      const result = await testConnection.mutateAsync({
        provider,
        model,
        apiKey: apiKey.trim() || undefined,
      });
      onFeedback({ tone: 'success', message: result.message });
    } catch (error) {
      onFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError
            ? error.message
            : 'Não foi possível validar a conexão com o provedor de IA.',
      });
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    onFeedback(null);

    try {
      await saveSettings.mutateAsync(buildInput());
      setApiKey('');
      setClearCredentials(false);
      onFeedback({ tone: 'success', message: 'Configurações de IA salvas.' });
    } catch (error) {
      onFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError
            ? error.message
            : 'Não foi possível salvar as configurações de IA.',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Inteligência Artificial
            </CardTitle>
            <CardDescription>
              A IA auxilia os atendentes a corrigir e formalizar mensagens antes do envio pelo
              WhatsApp. Nenhuma mensagem é enviada automaticamente.
            </CardDescription>
          </div>
          <StatusBadge
            tone={initial.available ? 'success' : initial.enabled ? 'warning' : 'secondary'}
          >
            {initial.available ? 'Pronta para uso' : initial.enabled ? 'Incompleta' : 'Desativada'}
          </StatusBadge>
        </div>
      </CardHeader>

      <CardContent>
        <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
          <section className="space-y-2">
            <p className="text-sm font-medium">Provedor</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {catalog.providers.map((item) => {
                const selected = item.id === provider;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleProviderChange(item.id)}
                    aria-pressed={selected}
                    disabled={!canManage || pending}
                    className={cn(
                      'flex h-full min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-hover',
                      !canManage && 'cursor-default',
                    )}
                  >
                    <AiProviderLogo provider={item.id} className="mt-0.5 size-5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    {selected ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ai-model" label="Modelo" required>
              <Select value={model} onValueChange={setModel} disabled={!canManage || pending}>
                <SelectTrigger id="ai-model" aria-label="Modelo de IA">
                  <SelectValue placeholder="Selecione um modelo" />
                </SelectTrigger>
                <SelectContent>
                  {providerDefinition.models.map((item) => (
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
                <p className="text-sm font-medium">Ativar IA no atendimento</p>
                <p className="text-xs text-muted-foreground">
                  O botão de formalização só aparece quando a configuração está ativa e completa.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canManage || pending}
                aria-label="Ativar IA no atendimento"
              />
            </div>
          </div>

          <section className="space-y-2">
            <p className="text-sm font-medium">Nível de formalidade</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {catalog.formalities.map((item) => {
                const selected = item.id === formality;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFormality(item.id)}
                    aria-pressed={selected}
                    disabled={!canManage || pending}
                    className={cn(
                      'min-w-0 rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-hover',
                      !canManage && 'cursor-default',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {item.label}
                      {selected ? <Check className="size-4 text-primary" /> : null}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="size-4 text-muted-foreground" />
                Credenciais
              </div>
              {credentialConfigured ? (
                <Badge variant="success">
                  <ShieldCheck />
                  Credencial configurada
                </Badge>
              ) : (
                <Badge variant="warning">Credencial não configurada</Badge>
              )}
            </div>

            <FormField
              id="ai-api-key"
              label={providerDefinition.credentialLabel}
              description={
                credentialConfigured
                  ? 'Já existe uma credencial salva. Deixe o campo vazio para mantê-la.'
                  : 'A credencial é armazenada criptografada e nunca é exibida novamente.'
              }
            >
              <Input
                id="ai-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  if (event.target.value.trim().length > 0) {
                    setClearCredentials(false);
                  }
                }}
                placeholder={credentialConfigured ? '••••••••' : 'Informe a credencial'}
                autoComplete="new-password"
                disabled={!canManage || pending}
              />
            </FormField>

            {credentialConfigured && canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setClearCredentials((value) => !value);
                    setApiKey('');
                    onFeedback(
                      clearCredentials
                        ? null
                        : {
                            tone: 'info',
                            message: 'A credencial será removida ao salvar.',
                          },
                    );
                  }}
                  disabled={pending}
                >
                  <Trash2 />
                  {clearCredentials ? 'Cancelar remoção' : 'Remover credencial'}
                </Button>
                {clearCredentials ? (
                  <span className="text-xs font-medium text-danger">
                    A credencial será removida ao salvar.
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>

          {!canManage ? (
            <p className="text-xs text-muted-foreground">
              Apenas proprietários e administradores podem alterar as configurações de IA.
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
                Testar conexão
              </Button>
              <Button type="submit" disabled={pending || !model}>
                {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                Salvar configurações
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
