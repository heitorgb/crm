import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import type { WhatsAppInstance } from '@/types/whatsapp';
import { formatHistorySyncUpdatedAt, isHistorySyncStale } from './history-sync-utils';

const COMPLETION_NOTICE_MS = 12_000;
const RECENT_COMPLETION_MS = 2 * 60 * 1000;

interface HistorySyncBannerProps {
  instances: WhatsAppInstance[];
  selectedInstanceId: string;
}

function instanceLabel(instances: WhatsAppInstance[]): string {
  if (instances.length === 1) {
    return instances[0].name;
  }
  return `${instances.length} instâncias`;
}

function syncMeta(instance: WhatsAppInstance): string | null {
  const parts: string[] = [];
  if (instance.historySync.chunks !== null && instance.historySync.chunks > 0) {
    parts.push(
      `${instance.historySync.chunks} lote${instance.historySync.chunks === 1 ? '' : 's'} recebido${
        instance.historySync.chunks === 1 ? '' : 's'
      }`,
    );
  }
  const updatedAt = formatHistorySyncUpdatedAt(instance.historySync.updatedAt);
  if (updatedAt) {
    parts.push(`Última atualização ${updatedAt}`);
  }
  return parts.length > 0 ? parts.join(' • ') : null;
}

function ProgressBar({ progress }: { progress: number | null }) {
  if (progress === null) {
    return (
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full w-1/3 animate-pulse rounded-full bg-info/70" />
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Progresso da sincronização do histórico"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full rounded-full bg-info transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-info">{progress}%</span>
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Ocultar aviso de sincronização"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

export function HistorySyncBanner({ instances, selectedInstanceId }: HistorySyncBannerProps) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [hiddenCompletionKey, setHiddenCompletionKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const relevant = useMemo(
    () =>
      instances.filter(
        (instance) =>
          instance.active && (selectedInstanceId === 'ALL' || instance.id === selectedInstanceId),
      ),
    [instances, selectedInstanceId],
  );

  const syncing = relevant.filter((instance) => instance.historySync.status === 'SYNCING');
  const failed = relevant.filter((instance) => instance.historySync.status === 'FAILED');

  const recentCompleted = useMemo(() => {
    return (
      relevant
        .filter((instance) => {
          if (
            instance.historySync.status !== 'COMPLETED' ||
            instance.historySync.completedAt === null
          ) {
            return false;
          }
          const age = now - new Date(instance.historySync.completedAt).getTime();
          // Accept a small clock skew, but not a completion dated far in the
          // future (the provider timestamp is defensive input).
          return age >= -60_000 && age < RECENT_COMPLETION_MS;
        })
        .sort(
          (left, right) =>
            new Date(right.historySync.completedAt as string).getTime() -
            new Date(left.historySync.completedAt as string).getTime(),
        )[0] ?? null
    );
  }, [relevant, now]);

  const failureKey =
    failed.length > 0
      ? `failed:${failed
          .map(
            (item) =>
              `${item.id}:${item.historySync.updatedAt ?? item.historySync.completedAt ?? ''}`,
          )
          .join(',')}`
      : null;
  const syncingKey =
    syncing.length > 0
      ? `sync:${syncing.map((item) => `${item.id}:${item.historySync.startedAt ?? ''}`).join(',')}`
      : null;

  const recentId = recentCompleted?.id ?? null;
  const recentName = recentCompleted?.name ?? null;
  const recentCompletedAt = recentCompleted?.historySync.completedAt ?? null;
  const recentMessages = recentCompleted?.historySync.messages ?? null;
  const recentKey = recentId && recentCompletedAt ? `${recentId}:${recentCompletedAt}` : null;
  const completion =
    recentKey && hiddenCompletionKey !== recentKey
      ? { name: recentName ?? 'WhatsApp', messages: recentMessages }
      : null;

  useEffect(() => {
    if (!recentKey) {
      return;
    }
    const timer = setTimeout(() => setHiddenCompletionKey(recentKey), COMPLETION_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [recentKey]);

  if (failureKey && dismissedKey !== failureKey) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 border-b border-border bg-warning/10 px-3 py-2 text-warning sm:px-4"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            Não foi possível confirmar a sincronização do histórico
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            As mensagens novas continuam sendo recebidas. Você pode continuar usando o Atendimento
            normalmente.
          </p>
        </div>
        <DismissButton onClick={() => setDismissedKey(failureKey)} />
      </div>
    );
  }

  if (syncingKey && dismissedKey !== syncingKey) {
    const single = syncing.length === 1 ? syncing[0] : null;
    const stale = syncing.every((instance) => isHistorySyncStale(instance.historySync, now));
    const progress = single && !stale ? single.historySync.progress : null;
    const meta = single ? syncMeta(single) : null;

    return (
      <div
        role="status"
        aria-live="polite"
        className="border-b border-border bg-info/5 px-3 py-2 sm:px-4"
      >
        <div className="flex items-start gap-2">
          {stale ? (
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-info" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">
              {stale
                ? 'Sincronização do histórico sem atualizações recentes'
                : `Sincronizando histórico do WhatsApp — ${instanceLabel(syncing)}`}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {stale
                ? 'O WhatsApp não envia atualizações há alguns minutos. As mensagens novas continuam sendo recebidas; você pode continuar usando o CRM.'
                : syncing.length > 1
                  ? 'Os WhatsApps estão conectados. Estamos processando a sincronização inicial do histórico. Isso pode levar alguns minutos.'
                  : 'Seu WhatsApp está conectado. Estamos processando a sincronização inicial do histórico. Isso pode levar alguns minutos.'}
            </p>

            {!stale ? <ProgressBar progress={progress} /> : null}

            <p className="mt-1 text-[11px] text-muted-foreground">
              {stale
                ? (meta ?? 'Progresso ainda não informado pelo WhatsApp.')
                : (meta ?? 'Aguardando informações de progresso do WhatsApp.')}
            </p>
          </div>
          <DismissButton onClick={() => setDismissedKey(syncingKey)} />
        </div>
      </div>
    );
  }

  if (completion && !syncingKey) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-2 border-b border-border bg-success/5 px-3 py-2 sm:px-4"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            Histórico do WhatsApp sincronizado — {completion.name}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {completion.messages !== null && completion.messages > 0
              ? `${completion.messages} mensagens processadas. `
              : ''}
            Você já pode continuar usando o Atendimento normalmente.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
