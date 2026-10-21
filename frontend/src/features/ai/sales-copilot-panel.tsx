import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Lightbulb,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  SalesAnalysis,
  SalesReplySuggestion,
} from '@/types/ai';
import type { Conversation } from '@/types/attendance';
import type { LeadCard } from '@/types/crm';
import {
  useAiSettings,
  useAnalyzeSalesOpportunity,
  useSuggestSalesReply,
} from './queries';

interface SalesCopilotPanelProps {
  lead: LeadCard;
  conversation: Conversation | null;
  conversationId: string | null;
  latestMessageId: string | null;
  onUseReply: (text: string, conversationId: string) => void;
  onClose?: () => void;
}

interface ReplyState {
  text: string;
  generatedAt: string;
  conversationId: string | null;
}

export function SalesCopilotPanel({
  lead,
  conversation,
  conversationId,
  latestMessageId,
  onUseReply,
  onClose,
}: SalesCopilotPanelProps) {
  const settings = useAiSettings();
  const analyze = useAnalyzeSalesOpportunity();
  const suggest = useSuggestSalesReply();
  const [analysis, setAnalysis] = useState<SalesAnalysis | null>(null);
  const [reply, setReply] = useState<ReplyState | null>(null);
  const [alternativeReply, setAlternativeReply] = useState<ReplyState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aiAvailable = settings.data?.available === true;
  const stale = useMemo(() => {
    if (!analysis) {
      return false;
    }
    if (analysis.context.conversationId !== conversationId) {
      return true;
    }
    if (latestMessageId !== null && latestMessageId !== analysis.context.latestMessageId) {
      return true;
    }
    return (
      new Date(lead.updatedAt).getTime() >
      new Date(analysis.context.leadUpdatedAt).getTime()
    );
  }, [analysis, conversationId, latestMessageId, lead.updatedAt]);

  const handleAnalyze = async (): Promise<void> => {
    setError(null);
    try {
      const result = await analyze.mutateAsync({
        leadId: lead.id,
        conversationId: conversationId ?? undefined,
      });
      setAnalysis(result);
      setReply({
        text: result.suggestedReply,
        generatedAt: result.generatedAt,
        conversationId: result.context.conversationId,
      });
      setAlternativeReply(null);
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível analisar a oportunidade.'));
    }
  };

  const handleSuggestReply = async (): Promise<void> => {
    setError(null);
    try {
      const previousAnalysis =
        analysis && !stale ? summarizeAnalysis(analysis) : undefined;
      const result = await suggest.mutateAsync({
        leadId: lead.id,
        conversationId: conversationId ?? undefined,
        previousAnalysis,
      });
      const next = toReplyState(result);
      if (reply) {
        setAlternativeReply(next);
      } else {
        setReply(next);
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível gerar uma resposta.'));
    }
  };

  const insertReply = (value: ReplyState): void => {
    if (!value.conversationId || value.conversationId !== conversationId) {
      setError('A conversa mudou. Gere a sugestão novamente para a conversa atual.');
      return;
    }
    onUseReply(value.text, value.conversationId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex items-start gap-2 border-b border-border px-3 py-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Copiloto comercial</h2>
          <p className="truncate text-[11px] text-muted-foreground">{lead.title}</p>
        </div>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={onClose}
            aria-label="Fechar copiloto"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-thin p-3">
        {settings.isPending ? (
          <PanelSkeleton />
        ) : settings.isError ? (
          <PanelNotice
            tone="warning"
            title="Não foi possível verificar a IA"
            description="Tente novamente para consultar a configuração da organização."
            action={
              <Button variant="outline" size="sm" onClick={() => void settings.refetch()}>
                <RefreshCw />
                Tentar novamente
              </Button>
            }
          />
        ) : !aiAvailable ? (
          <PanelNotice
            title="IA não configurada"
            description={
              settings.data?.enabled === false
                ? 'A IA está desativada para esta organização. Ative a funcionalidade para usar o copiloto.'
                : 'Configure um provedor e uma credencial válida para usar o copiloto comercial.'
            }
            action={
              <Button size="sm" asChild>
                <Link to="/configuracoes?tab=ai">Configurar IA</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-[11px] text-muted-foreground">
              {conversationId
                ? conversation
                  ? `Conversa analisada: ${conversation.isGroup ? (conversation.groupName ?? 'Grupo') : (conversation.contactName ?? conversation.contactPhone ?? 'Contato')}`
                  : 'Conversa selecionada. O histórico será carregado pelo servidor.'
                : 'Nenhuma conversa selecionada. A análise usará apenas os dados comerciais.'}
            </div>

            {error ? (
              <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <p>{error}</p>
                </div>
              </div>
            ) : null}

            {!analysis ? (
              <PanelNotice
                title="Analise esta oportunidade"
                description="O copiloto resume a conversa, identifica o que já se sabe, aponta lacunas e sugere a próxima pergunta."
                action={
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => void handleAnalyze()}
                      disabled={analyze.isPending || suggest.isPending}
                    >
                      {analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      {analyze.isPending ? 'Analisando...' : 'Analisar oportunidade'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleSuggestReply()}
                      disabled={suggest.isPending || analyze.isPending}
                    >
                      {suggest.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                      {suggest.isPending ? 'Gerando...' : 'Sugerir resposta'}
                    </Button>
                  </div>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{formatDateTime(analysis.generatedAt)}</Badge>
                  {stale ? (
                    <Badge variant="warning">
                      <AlertTriangle />
                      Contexto desatualizado
                    </Badge>
                  ) : null}
                  {analysis.context.historyTruncated ? (
                    <Badge variant="outline">Histórico parcial</Badge>
                  ) : null}
                  {analysis.context.mediaWithoutText > 0 ? (
                    <Badge variant="outline">
                      {analysis.context.mediaWithoutText} mídia(s) sem texto
                    </Badge>
                  ) : null}
                </div>

                {stale ? (
                  <p className="rounded-md bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
                    Chegaram novas mensagens ou os dados da oportunidade mudaram. Reanalise para atualizar o contexto.
                  </p>
                ) : null}

                {analysis.context.messageCount === 0 ? (
                  <p className="rounded-md bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
                    Não há histórico de mensagens suficiente nesta conversa. A análise considera apenas os dados comerciais.
                  </p>
                ) : null}

                <Section title="Resumo da oportunidade" icon={Sparkles}>
                  <p>{analysis.summary}</p>
                </Section>

                <Section title="Necessidade identificada" icon={Lightbulb}>
                  <p>{analysis.need}</p>
                </Section>

                <Section title="Informações conhecidas" icon={CheckCircle2}>
                  {analysis.knownInformation.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-4">
                      {analysis.knownInformation.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">Nenhuma informação explícita identificada.</p>
                  )}
                </Section>

                <Section title="Informações pendentes" icon={CircleHelp}>
                  {analysis.pendingInformation.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-4">
                      {analysis.pendingInformation.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">Nenhuma lacuna relevante identificada.</p>
                  )}
                </Section>

                <Section title="Próxima pergunta recomendada" icon={MessageCircleQuestion} highlighted>
                  <p>{analysis.nextQuestion}</p>
                </Section>

                <Section title="Por que esta abordagem" icon={Lightbulb}>
                  <p>{analysis.rationale}</p>
                </Section>

                <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleAnalyze()}
                    disabled={analyze.isPending || suggest.isPending}
                  >
                    {analyze.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {analyze.isPending ? 'Reanalisando...' : 'Reanalisar'}
                  </Button>
                  {!reply ? (
                    <Button
                      size="sm"
                      onClick={() => void handleSuggestReply()}
                      disabled={suggest.isPending}
                    >
                      {suggest.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                      {suggest.isPending ? 'Gerando...' : 'Sugerir resposta'}
                    </Button>
                  ) : null}
                </div>
              </>
            )}

            {reply ? (
              <ReplyCard
                title="Resposta sugerida"
                text={reply.text}
                generatedAt={reply.generatedAt}
                canUse={Boolean(conversationId) && reply.conversationId === conversationId}
                pending={suggest.isPending}
                onUse={() => insertReply(reply)}
                onSuggest={() => void handleSuggestReply()}
              />
            ) : null}

            {alternativeReply ? (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-primary">Nova sugestão</p>
                  <Badge variant="outline">{formatDateTime(alternativeReply.generatedAt)}</Badge>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed">{alternativeReply.text}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => insertReply(alternativeReply)}>
                    Usar esta resposta
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReply(alternativeReply);
                      setAlternativeReply(null);
                    }}
                  >
                    Substituir atual
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAlternativeReply(null)}>
                    Descartar
                  </Button>
                </div>
              </div>
            ) : null}

            {!analysis && analyze.isPending ? (
              <p className="sr-only" role="status">Analisando oportunidade</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ReplyCard({
  title,
  text,
  generatedAt,
  canUse,
  pending,
  onUse,
  onSuggest,
}: {
  title: string;
  text: string;
  generatedAt: string;
  canUse: boolean;
  pending: boolean;
  onUse: () => void;
  onSuggest: () => void;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-primary">{title}</h3>
        <span className="text-[10px] text-muted-foreground">{formatDateTime(generatedAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{text}</p>
      <div className="flex flex-wrap gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" onClick={onUse} disabled={!canUse || pending}>
                Usar resposta
              </Button>
            </span>
          </TooltipTrigger>
          {!canUse ? (
            <TooltipContent>Selecione a conversa do contato para inserir a resposta.</TooltipContent>
          ) : null}
        </Tooltip>
        <Button size="sm" variant="outline" onClick={onSuggest} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {pending ? 'Gerando...' : 'Gerar outra'}
        </Button>
      </div>
    </section>
  );
}

function Section({
  title,
  icon: Icon,
  highlighted = false,
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  highlighted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'space-y-1 rounded-md border p-2.5',
        highlighted ? 'border-primary/30 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </h3>
      <div className="text-xs leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

function PanelNotice({
  title,
  description,
  action,
  tone = 'default',
}: {
  title: string;
  description: string;
  action?: ReactNode;
  tone?: 'default' | 'warning';
}) {
  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border p-3',
        tone === 'warning' ? 'border-warning/30 bg-warning/10' : 'border-border bg-surface',
      )}
    >
      <div className="flex items-start gap-2">
        {tone === 'warning' ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        ) : (
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        )}
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      {action ? <div className="pl-6">{action}</div> : null}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-14 animate-pulse rounded-md bg-muted" />
      <div className="h-20 animate-pulse rounded-md bg-muted" />
      <div className="h-20 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

function summarizeAnalysis(analysis: SalesAnalysis): string {
  return [
    `Resumo: ${analysis.summary}`,
    `Necessidade: ${analysis.need}`,
    `Informações conhecidas: ${analysis.knownInformation.join('; ') || 'nenhuma'}`,
    `Informações pendentes: ${analysis.pendingInformation.join('; ') || 'nenhuma'}`,
    `Próxima pergunta: ${analysis.nextQuestion}`,
    `Justificativa: ${analysis.rationale}`,
  ]
    .join('\n')
    .slice(0, 4_000);
}

function toReplyState(result: SalesReplySuggestion): ReplyState {
  return {
    text: result.reply,
    generatedAt: result.generatedAt,
    conversationId: result.context.conversationId,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}
