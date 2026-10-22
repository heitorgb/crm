import { AlertCircle, Clock, Loader2, Mic, RotateCcw } from 'lucide-react';
import { useTranscriptionSettings } from '@/features/ai/queries';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { ConversationMessage } from '@/types/attendance';
import { useRetryTranscription } from './queries';

export function MessageTranscription({ message }: { message: ConversationMessage }) {
  const retry = useRetryTranscription();
  const transcriptionSettings = useTranscriptionSettings();
  const transcription = message.transcription;
  const canRequestTranscription = transcriptionSettings.data?.enabled === true;

  if (message.type !== 'AUDIO' || message.direction !== 'INBOUND') {
    return null;
  }

  const retryErrorMessage =
    retry.error instanceof ApiError
      ? retry.error.message
      : 'Não foi possível iniciar a transcrição. Verifique a configuração de áudio.';

  if (!transcription) {
    if (!canRequestTranscription) {
      return null;
    }

    return (
      <div className="mt-2 space-y-1">
        <p className="text-[11px] italic text-muted-foreground">
          Transcrição não realizada para este áudio.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 px-2 text-[11px]', retry.isPending && 'opacity-70')}
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate({ conversationId: message.conversationId, messageId: message.id })
          }
        >
          {retry.isPending ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <Mic className="size-3" aria-hidden />
          )}
          Transcrever este áudio
        </Button>
        {retry.isError ? (
          <p role="alert" className="text-[11px] text-danger">
            {retryErrorMessage}
          </p>
        ) : null}
      </div>
    );
  }

  if (transcription.status === 'COMPLETED' && transcription.text) {
    return (
      <section
        aria-label="Transcrição do áudio"
        className="mt-2 rounded-md border-l-2 border-primary/60 bg-surface/70 px-2 py-1.5"
      >
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Mic className="size-3" aria-hidden />
          Transcrição do áudio
        </p>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-foreground/85 [overflow-wrap:anywhere]">
          {transcription.text}
        </p>
      </section>
    );
  }

  if (transcription.status === 'PENDING' || transcription.status === 'PROCESSING') {
    const processing = transcription.status === 'PROCESSING' || retry.isPending;
    return (
      <p
        role="status"
        className="mt-2 flex items-center gap-1.5 text-[11px] italic text-muted-foreground"
      >
        {processing ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <Clock className="size-3" aria-hidden />
        )}
        {processing ? 'Transcrevendo áudio…' : 'Aguardando transcrição do áudio…'}
      </p>
    );
  }

  if (transcription.status === 'FAILED') {
    return (
      <div className="mt-2 space-y-1">
        <p role="alert" className="flex items-start gap-1.5 text-[11px] text-danger">
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            {transcription.errorMessage ?? 'Não foi possível transcrever este áudio.'}
          </span>
        </p>
        {transcription.canRetry && canRequestTranscription ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('h-7 px-2 text-[11px]', retry.isPending && 'opacity-70')}
            disabled={retry.isPending}
            onClick={() => retry.mutate({ conversationId: message.conversationId, messageId: message.id })}
          >
            {retry.isPending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="size-3" aria-hidden />
            )}
            Tentar transcrever novamente
          </Button>
        ) : null}
        {retry.isError ? (
          <p role="alert" className="text-[11px] text-danger">
            {retryErrorMessage}
          </p>
        ) : null}
      </div>
    );
  }

  if (transcription.status === 'NOT_APPLICABLE') {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-[11px] italic text-muted-foreground">
          Transcrição de áudio não disponível por configuração.
        </p>
        {transcription.canRetry && canRequestTranscription ? (
          <>
            <p className="text-[11px] text-muted-foreground">
              A transcrição pode ter sido ativada depois que este áudio foi recebido.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 text-[11px]', retry.isPending && 'opacity-70')}
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate({ conversationId: message.conversationId, messageId: message.id })
              }
            >
              {retry.isPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <Mic className="size-3" aria-hidden />
              )}
              Transcrever este áudio
            </Button>
            {retry.isError ? (
              <p role="alert" className="text-[11px] text-danger">
                {retryErrorMessage}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return null;
}
