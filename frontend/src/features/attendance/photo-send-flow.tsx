import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useConversations } from '@/features/attendance/queries';
import type {
  BulkMediaBatchStatus,
  BulkMediaRecipientStatus,
} from '@/types/bulk-media';
import type { Conversation } from '@/types/attendance';
import { conversationLabel } from './attendance-utils';
import { compressImage } from './compress-image';
import { SenderAvatar } from './sender-avatar';
import {
  usePhotoBatch,
  useRetryPhotoBatch,
  useSendPhotoBatch,
} from './queries';

type Step = 'capture' | 'recipients' | 'result';

const recipientStatusLabel: Record<BulkMediaRecipientStatus, string> = {
  PENDING: 'Pendente',
  PROCESSING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorado',
};

const recipientStatusTone: Record<BulkMediaRecipientStatus, StatusTone> = {
  PENDING: 'secondary',
  PROCESSING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'secondary',
};

const batchStatusLabel: Record<BulkMediaBatchStatus, string> = {
  PENDING: 'Preparando envio',
  PROCESSING: 'Enviando fotos',
  COMPLETED: 'Enviado',
  PARTIAL: 'Enviado com falhas',
  FAILED: 'Falhou',
};

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `photo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface PhotoSendFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PhotoSendFlow({ open, onOpenChange }: PhotoSendFlowProps) {
  const [step, setStep] = useState<Step>('capture');
  const [prepared, setPrepared] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchId, setBatchId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  const previewUrl = useMemo(
    () => (prepared ? URL.createObjectURL(prepared) : null),
    [prepared],
  );

  const conversationsQuery = useConversations({
    perPage: 100,
    search: debouncedSearch || undefined,
    archived: false,
  });
  const sendPhoto = useSendPhotoBatch();
  const retryPhoto = useRetryPhotoBatch();
  const batchQuery = usePhotoBatch(batchId);
  const batch = batchQuery.data ?? sendPhoto.data ?? null;

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  useEffect(() => {
    if (!open || step !== 'capture' || prepared) {
      return undefined;
    }
    const timer = window.setTimeout(() => cameraInputRef.current?.click(), 250);
    return () => window.clearTimeout(timer);
  }, [open, step, prepared]);

  useEffect(() => {
    if (!open || step !== 'capture' || prepared) {
      return undefined;
    }
    const timer = window.setTimeout(() => cameraInputRef.current?.click(), 250);
    return () => window.clearTimeout(timer);
  }, [open, step, prepared]);

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Selecione uma imagem.');
      return;
    }

    setError(null);
    setCompressing(true);
    try {
      setPrepared(await compressImage(file));
    } catch {
      setError('Não foi possível preparar a imagem. Tente outra foto.');
    } finally {
      setCompressing(false);
    }
  };

  const selectedConversations = useMemo(
    () => (conversationsQuery.data?.data ?? []).filter((item) => selectedIds.has(item.id)),
    [conversationsQuery.data?.data, selectedIds],
  );

  const toggleSelected = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = (): void => {
    const conversations = conversationsQuery.data?.data ?? [];
    setSelectedIds((current) => {
      const allSelected =
        conversations.length > 0 && conversations.every((item) => current.has(item.id));
      if (allSelected) {
        return new Set();
      }
      return new Set(conversations.map((item) => item.id));
    });
  };

  const handleSend = async (): Promise<void> => {
    if (!prepared || selectedIds.size === 0 || sendPhoto.isPending) {
      return;
    }
    setError(null);
    try {
      const result = await sendPhoto.mutateAsync({
        file: prepared,
        caption: caption.trim() || undefined,
        conversationIds: [...selectedIds],
        idempotencyKey,
      });
      setBatchId(result.id);
      setStep('result');
    } catch {
      setError('Não foi possível iniciar o envio. Verifique a conexão e tente novamente.');
    }
  };

  const handleRetry = (): void => {
    if (batchId) {
      retryPhoto.mutate(batchId);
    }
  };

  const resetFlow = (): void => {
    setStep('capture');
    setPrepared(null);
    setCaption('');
    setCompressing(false);
    setError(null);
    setSearch('');
    setSelectedIds(new Set());
    setBatchId(null);
    setIdempotencyKey(newIdempotencyKey());
  };

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      resetFlow();
    }
    onOpenChange(next);
  };

  const close = (): void => handleOpenChange(false);
  const isSending = sendPhoto.isPending;
  const isProcessing = batch?.status === 'PENDING' || batch?.status === 'PROCESSING';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => void handleFileSelected(event)}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void handleFileSelected(event)}
        />

        {step === 'capture' ? (
          <>
            <DialogHeader>
              <DialogTitle>Enviar foto</DialogTitle>
            </DialogHeader>

            {prepared && previewUrl ? (
              <div className="space-y-3">
                <div className="flex max-h-[45vh] items-center justify-center overflow-hidden rounded-lg bg-slate-950/70">
                  <img
                    src={previewUrl}
                    alt="Prévia da foto"
                    className="max-h-[45vh] w-full object-contain"
                  />
                </div>
                <Textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="Legenda (opcional)"
                  className="max-h-28 min-h-[42px] resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  A foto será comprimida antes do envio. A legenda vale para todos os contatos.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <EmptyState
                  icon={Camera}
                  title="Abrir a câmera"
                  description="Tire uma foto agora ou escolha uma imagem da galeria."
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => cameraInputRef.current?.click()} disabled={compressing}>
                    <Camera />
                    Câmera
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={compressing}
                  >
                    <ImageIcon />
                    Galeria
                  </Button>
                </div>
                {compressing ? (
                  <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Preparando imagem…
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Se a câmera não abrir, verifique a permissão do navegador ou escolha da galeria.
                </p>
              </div>
            )}

            {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}

            <DialogFooter>
              {prepared ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPrepared(null);
                      setError(null);
                    }}
                  >
                    Refazer
                  </Button>
                  <Button
                    onClick={() => {
                      setError(null);
                      setStep('recipients');
                    }}
                    disabled={compressing}
                  >
                    <Check />
                    Continuar
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={close} disabled={compressing}>
                  Cancelar
                </Button>
              )}
            </DialogFooter>
          </>
        ) : null}

        {step === 'recipients' ? (
          <>
            <DialogHeader>
              <DialogTitle>Escolher contatos</DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar contato ou conversa"
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{selectedIds.size} selecionado(s)</span>
                <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                  {conversationsQuery.data?.data.length &&
                  conversationsQuery.data.data.every((item) => selectedIds.has(item.id))
                    ? 'Desmarcar todos'
                    : 'Selecionar todos'}
                </Button>
              </div>
            </div>

            <div className="-mx-1 max-h-[38vh] overflow-y-auto px-1">
              {conversationsQuery.isPending ? (
                <div className="space-y-2 py-2">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : conversationsQuery.isError ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <p className="text-sm font-medium text-danger">
                    Não foi possível carregar as conversas.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void conversationsQuery.refetch()}>
                    <RefreshCw />
                    Tentar novamente
                  </Button>
                </div>
              ) : (conversationsQuery.data?.data.length ?? 0) === 0 ? (
                <EmptyState
                  icon={ImageIcon}
                  title="Nenhuma conversa encontrada"
                  description="Ajuste a busca para encontrar contatos."
                />
              ) : (
                conversationsQuery.data?.data.map((conversation) => (
                  <RecipientCheckbox
                    key={conversation.id}
                    conversation={conversation}
                    checked={selectedIds.has(conversation.id)}
                    onToggle={() => toggleSelected(conversation.id)}
                  />
                ))
              )}
            </div>

            {selectedConversations.length > 0 ? (
              <p className="truncate text-xs text-muted-foreground">
                Para: {selectedConversations.map((item) => conversationLabel(item)).join(', ')}
              </p>
            ) : null}
            {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('capture')} disabled={isSending}>
                <ChevronLeft />
                Voltar
              </Button>
              <Button
                onClick={() => void handleSend()}
                disabled={isSending || selectedIds.size === 0 || !prepared}
              >
                {isSending ? <Loader2 className="animate-spin" /> : <Send />}
                Enviar
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 'result' && batch ? (
          <>
            <DialogHeader>
              <DialogTitle>{batchStatusLabel[batch.status]}</DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${
                      batch.totalCount > 0
                        ? ((batch.successCount + batch.failureCount) / batch.totalCount) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {batch.successCount} enviada(s) · {batch.failureCount} falha(s) ·{' '}
                {batch.totalCount} total
              </p>

              <div className="max-h-[38vh] space-y-1 overflow-y-auto">
                {batch.recipients.map((recipient) => (
                  <div
                    key={recipient.id}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{recipient.name}</p>
                      {recipient.errorCode ? (
                        <p className="truncate text-[11px] text-danger">
                          {recipient.errorMessage ?? recipient.errorCode}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge tone={recipientStatusTone[recipient.status]} withDot={false}>
                      {recipientStatusLabel[recipient.status]}
                    </StatusBadge>
                  </div>
                ))}
              </div>

              {batchQuery.isError ? (
                <p className="text-xs font-medium text-danger">
                  Não foi possível atualizar o status. O envio continua no servidor.
                </p>
              ) : null}
            </div>

            <DialogFooter>
              {batch.failureCount > 0 && !isProcessing ? (
                <Button
                  variant="outline"
                  onClick={handleRetry}
                  disabled={retryPhoto.isPending}
                >
                  {retryPhoto.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Reenviar falhas
                </Button>
              ) : null}
              <Button onClick={close} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="animate-spin" /> : null}
                {isProcessing ? 'Enviando…' : 'Concluir'}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecipientCheckbox({
  conversation,
  checked,
  onToggle,
}: {
  conversation: Conversation;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
      />
      <SenderAvatar
        conversationId={conversation.id}
        jid={conversation.isGroup ? null : conversation.externalContactId}
        name={conversationLabel(conversation)}
        src={conversation.avatarUrl}
        className="size-9"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{conversationLabel(conversation)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {conversation.contactPhone ?? conversation.instanceName}
        </p>
      </div>
    </label>
  );
}
