import { useState, type FormEvent } from 'react';
import { Check, KeyRound, Loader2, Mic, PlugZap, Save, Sparkles } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { StatusBadge } from '@/components/common/status-badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { AiCatalog, AiFormality, AiProvider, AiSettings } from '@/types/ai';
import { AiCredentialsTab } from './ai-credentials-tab';
import { AiProviderLogo } from './ai-provider-logo';
import { useAiCatalog, useAiSettings, useSaveAiSettings, useTestAiConnection } from './queries';
import { TranscriptionSettingsCard } from './transcription-settings-card';

interface Feedback {
  tone: 'success' | 'danger' | 'info';
  message: string;
}

interface AiSettingsTabProps {
  canManage: boolean;
}

type AiSettingsSection = 'copilot' | 'transcription' | 'credentials';

function isAiSettingsSection(value: string): value is AiSettingsSection {
  return value === 'copilot' || value === 'transcription' || value === 'credentials';
}

export function AiSettingsTab({ canManage }: AiSettingsTabProps) {
  const catalog = useAiCatalog();
  const settings = useAiSettings();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [activeSection, setActiveSection] = useState<AiSettingsSection>('copilot');

  const handleSectionChange = (value: string): void => {
    if (isAiSettingsSection(value)) {
      setActiveSection(value);
    }
  };

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
    settings.data.provider,
    settings.data.model,
    settings.data.formality,
    settings.data.enabled,
  ].join('|');

  return (
    <Tabs value={activeSection} onValueChange={handleSectionChange}>
      <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
        <TabsTrigger value="copilot">
          <Sparkles />
          Copiloto IA
        </TabsTrigger>
        <TabsTrigger value="transcription">
          <Mic />
          Transcrição
        </TabsTrigger>
        <TabsTrigger value="credentials">
          <KeyRound />
          Credenciais
        </TabsTrigger>
      </TabsList>

      <TabsContent value="copilot" forceMount hidden={activeSection !== 'copilot'}>
        <AiSettingsForm
          key={key}
          canManage={canManage}
          initial={settings.data}
          catalog={catalog.data}
          feedback={feedback}
          onFeedback={setFeedback}
          onOpenCredentials={() => setActiveSection('credentials')}
        />
      </TabsContent>
      <TabsContent value="transcription" forceMount hidden={activeSection !== 'transcription'}>
        <TranscriptionSettingsCard canManage={canManage} />
      </TabsContent>
      <TabsContent value="credentials" forceMount hidden={activeSection !== 'credentials'}>
        <AiCredentialsTab
          canManage={canManage}
          catalog={catalog.data}
          settings={settings.data}
        />
      </TabsContent>
    </Tabs>
  );
}

function AiSettingsForm({
  canManage,
  initial,
  catalog,
  feedback,
  onFeedback,
  onOpenCredentials,
}: {
  canManage: boolean;
  initial: AiSettings;
  catalog: AiCatalog;
  feedback: Feedback | null;
  onFeedback: (feedback: Feedback | null) => void;
  onOpenCredentials: () => void;
}) {
  const saveSettings = useSaveAiSettings();
  const testConnection = useTestAiConnection();

  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [formality, setFormality] = useState<AiFormality>(initial.formality);
  const [enabled, setEnabled] = useState(initial.enabled);

  const providerDefinition =
    catalog.providers.find((item) => item.id === provider) ?? catalog.providers[0];
  const selectedModel = providerDefinition.models.find((item) => item.id === model);
  const credentialConfigured = initial.configuredProviders.includes(provider);
  const pending = saveSettings.isPending || testConnection.isPending;
  const fieldsDisabled = !canManage || pending || !enabled;
  const canTest = canManage && !pending && credentialConfigured && Boolean(model);

  const handleProviderChange = (nextProvider: AiProvider): void => {
    if (fieldsDisabled) {
      return;
    }
    const definition = catalog.providers.find((item) => item.id === nextProvider);
    if (!definition) {
      return;
    }
    setProvider(nextProvider);
    setModel(definition.models[0]?.id ?? '');
    onFeedback(null);
  };

  const handleTest = async (): Promise<void> => {
    onFeedback(null);
    try {
      const result = await testConnection.mutateAsync({
        provider,
        model,
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
      await saveSettings.mutateAsync({
        provider,
        model,
        formality,
        enabled,
      });
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
              Copiloto IA
            </CardTitle>
            <CardDescription>
              Configuração do provedor, modelo e formalidade usados na formalização de mensagens e
              no Copiloto comercial.
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
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Ativar IA no atendimento</p>
              <p className="text-xs text-muted-foreground">
                Controla o botão de formalização e o Copiloto. Desativar não remove provedor,
                modelo nem credenciais.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canManage || pending}
              aria-label="Ativar IA no atendimento"
            />
          </div>

          <section className="space-y-2">
            <p className="text-sm font-medium">Provedor</p>
            <div className="flex flex-wrap gap-2">
              {catalog.providers.map((item) => {
                const selected = item.id === provider;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleProviderChange(item.id)}
                    aria-label={`Provedor ${item.label}`}
                    aria-pressed={selected}
                    disabled={fieldsDisabled}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      selected
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-surface-hover',
                      fieldsDisabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                    )}
                  >
                    <AiProviderLogo provider={item.id} className="size-4" />
                    {item.label}
                    {selected ? <Check className="size-4 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
            <FormField
              id="ai-model"
              label="Modelo do Copiloto"
              required
              description="Define o modelo usado para reformular mensagens e analisar oportunidades."
            >
              <Select
                key={provider}
                value={model}
                onValueChange={setModel}
                disabled={fieldsDisabled}
              >
                <SelectTrigger
                  id="ai-model"
                  aria-label="Modelo de IA"
                  className="h-10 w-full bg-surface sm:max-w-md"
                >
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
            </FormField>
            {selectedModel ? (
              <p className="text-xs text-muted-foreground">{selectedModel.description}</p>
            ) : null}
          </section>

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
                    disabled={fieldsDisabled}
                    className={cn(
                      'min-w-0 rounded-lg border p-3 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-hover',
                      fieldsDisabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
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

          {enabled && !credentialConfigured ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">
                Configure a credencial de {providerDefinition.label} para habilitar o Copiloto.
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
