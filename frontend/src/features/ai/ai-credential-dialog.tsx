import { useState } from 'react';
import { Loader2, PlugZap, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { FormField } from '@/components/common/form-field';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { AiProvider, AiProviderOption } from '@/types/ai';
import { AiProviderLogo } from './ai-provider-logo';
import { useSaveAiCredential, useTestAiConnection } from './queries';

interface Feedback {
  tone: 'success' | 'danger' | 'info';
  message: string;
}

interface AiCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AiProvider;
  definition: AiProviderOption;
  configured: boolean;
  testModel: string;
  usedBy: string[];
  onRemoved: (message: string) => void;
}

export function AiCredentialDialog({
  open,
  onOpenChange,
  provider,
  definition,
  configured,
  testModel,
  usedBy,
  onRemoved,
}: AiCredentialDialogProps) {
  const saveCredential = useSaveAiCredential();
  const testConnection = useTestAiConnection();
  const [apiKey, setApiKey] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const pending = saveCredential.isPending || testConnection.isPending;
  const hasTypedKey = apiKey.trim().length > 0;
  const canSave = hasTypedKey && !pending;
  const canTest = (hasTypedKey || configured) && Boolean(testModel) && !pending;

  const handleSave = async (): Promise<void> => {
    setFeedback(null);
    try {
      await saveCredential.mutateAsync({
        provider,
        input: { apiKey: apiKey.trim() },
      });
      setApiKey('');
      setFeedback({ tone: 'success', message: 'Credencial salva.' });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError ? error.message : 'Não foi possível salvar a credencial.',
      });
    }
  };

  const handleTest = async (): Promise<void> => {
    setFeedback(null);
    try {
      const result = await testConnection.mutateAsync({
        provider,
        model: testModel,
        ...(hasTypedKey ? { apiKey: apiKey.trim() } : {}),
      });
      setFeedback({ tone: 'success', message: result.message });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError
            ? error.message
            : 'Não foi possível validar a conexão com o provedor.',
      });
    }
  };

  const handleRemove = async (): Promise<void> => {
    try {
      await saveCredential.mutateAsync({
        provider,
        input: { clearCredentials: true },
      });
      setRemoveOpen(false);
      setFeedback(null);
      setApiKey('');
      onRemoved('Credencial removida.');
      onOpenChange(false);
    } catch (error) {
      setRemoveOpen(false);
      setFeedback({
        tone: 'danger',
        message:
          error instanceof ApiError ? error.message : 'Não foi possível remover a credencial.',
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AiProviderLogo provider={provider} className="size-5" />
              Gerenciar credencial · {definition.label}
            </DialogTitle>
            <DialogDescription>
              A chave é armazenada criptografada e nunca é exibida completa.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={configured ? 'success' : 'warning'}>
              {configured ? 'Credencial configurada' : 'Credencial não configurada'}
            </StatusBadge>
            {usedBy.map((name) => (
              <Badge key={name} variant="secondary">
                {name}
              </Badge>
            ))}
            {usedBy.length > 1 ? (
              <Badge variant="info">
                <ShieldCheck />
                Compartilhada
              </Badge>
            ) : null}
          </div>

          <FormField
            id="ai-credential-key"
            label={definition.credentialLabel}
            description={
              configured
                ? 'Já existe uma credencial salva. Informe uma nova chave para substituí-la ou feche para manter a atual.'
                : 'A credencial é armazenada criptografada e nunca é exibida novamente.'
            }
          >
            <Input
              id="ai-credential-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={configured ? '••••••••' : 'Informe a credencial'}
              autoComplete="new-password"
              disabled={pending}
            />
          </FormField>

          {usedBy.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              Remover esta credencial afeta os recursos: {usedBy.join(' e ')}.
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

          {configured ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit text-danger hover:bg-danger/10 hover:text-danger"
              onClick={() => setRemoveOpen(true)}
              disabled={pending}
            >
              <Trash2 />
              Remover credencial
            </Button>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleTest()}
                disabled={!canTest}
              >
                {testConnection.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                Testar conexão
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
                {saveCredential.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                Salvar credencial
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remover credencial de ${definition.label}?`}
        description={
          usedBy.length > 1
            ? `A chave será removida e afetará ${usedBy.join(' e ')}. Esta ação não pode ser desfeita.`
            : 'A chave armazenada será removida. Esta ação não pode ser desfeita.'
        }
        confirmLabel="Remover"
        destructive
        loading={saveCredential.isPending}
        onConfirm={() => void handleRemove()}
      />
    </>
  );
}
