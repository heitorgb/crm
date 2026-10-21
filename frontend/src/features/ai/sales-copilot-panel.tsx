import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Clock,
  History,
  Lightbulb,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMembers } from '@/features/settings/queries';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  SalesFollowUp,
  SalesPersistedContext,
  SalesRecommendation,
  SalesReplySuggestion,
  SalesUpdateField,
} from '@/types/ai';
import type { Conversation } from '@/types/attendance';
import type { LeadCard } from '@/types/crm';
import {
  useAiSettings,
  useAnalyzeSalesOpportunity,
  useCreateSalesFollowUp,
  useDecideSalesRecommendation,
  useSalesCopilotContext,
  useSuggestSalesReply,
  useUpdateSalesFollowUp,
} from './queries';
import { SalesFollowUpDialog } from './sales-follow-up-dialog';

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

const UPDATE_FIELD_LABELS: Record<SalesUpdateField, string> = {
  NEED: 'Necessidade',
  PRODUCT: 'Produto ou serviço',
  BUDGET: 'Orçamento',
  DEADLINE: 'Prazo',
  USERS: 'Usuários ou volume',
  REQUIREMENTS: 'Requisitos técnicos',
  OBJECTION: 'Objeção',
  STAGE: 'Etapa do pipeline',
  LOSS_REASON: 'Motivo de perda',
  NOTES: 'Observação',
};

const RECOMMENDATION_STATUS_LABELS: Record<string, string> = {
  RECOMMENDED: 'Recomendada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  EXECUTED: 'Executada',
  CANCELED: 'Cancelada',
};

const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
};

export function SalesCopilotPanel({
  lead,
  conversation,
  conversationId,
  latestMessageId,
  onUseReply,
  onClose,
}: SalesCopilotPanelProps) {
  const settings = useAiSettings();
  const contextQuery = useSalesCopilotContext(lead.id, conversationId);
  const members = useMembers();
  const analyze = useAnalyzeSalesOpportunity();
  const suggest = useSuggestSalesReply();
  const decide = useDecideSalesRecommendation();
  const createFollowUp = useCreateSalesFollowUp();
  const updateFollowUp = useUpdateSalesFollowUp();

  const [reply, setReply] = useState<ReplyState | null>(null);
  const [alternativeReply, setAlternativeReply] = useState<ReplyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpRequest, setFollowUpRequest] = useState<{
    recommendation: SalesRecommendation | null;
    idempotencyKey: string;
  } | null>(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [editedValue, setEditedValue] = useState('');
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionResult, setCompletionResult] = useState('');

  const state = contextQuery.data ?? null;
  const context = state?.context ?? null;
  const aiAvailable = settings.data?.available === true;

  const localStale = useMemo(() => {
    if (!context) {
      return false;
    }
    if ((context.conversationId ?? null) !== (conversationId ?? null)) {
      return true;
    }
    if (latestMessageId !== null && latestMessageId !== context.latestMessageId) {
      return true;
    }
    return new Date(lead.updatedAt).getTime() > new Date(context.leadUpdatedAt).getTime();
  }, [context, conversationId, latestMessageId, lead.updatedAt]);

  const isStale = Boolean(state?.stale) || localStale;

  const currentReply: ReplyState | null =
    reply ??
    (context
      ? {
          text: context.suggestedReply,
          generatedAt: context.lastAnalyzedAt,
          conversationId: context.conversationId,
        }
      : null);

  const handleAnalyze = async (): Promise<void> => {
    setError(null);
    try {
      await analyze.mutateAsync({
        leadId: lead.id,
        conversationId: conversationId ?? undefined,
      });
      setReply(null);
      setAlternativeReply(null);
      setEditingSuggestionId(null);
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível analisar a oportunidade.'));
    }
  };

  const handleSuggestReply = async (): Promise<void> => {
    setError(null);
    try {
      const previousAnalysis =
        context && !isStale ? summarizeContext(context) : undefined;
      const result = await suggest.mutateAsync({
        leadId: lead.id,
        conversationId: conversationId ?? undefined,
        previousAnalysis,
      });
      const next = toReplyState(result);
      if (currentReply) {
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

  const decideRecommendation = async (
    recommendation: SalesRecommendation,
    action: 'ACCEPT' | 'REJECT' | 'CANCEL',
    value?: string,
  ): Promise<void> => {
    setError(null);
    try {
      await decide.mutateAsync({ id: recommendation.id, input: { action, value } });
      if (action === 'ACCEPT') {
        setEditingSuggestionId(null);
        setEditedValue('');
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível atualizar a recomendação.'));
    }
  };

  const openFollowUp = (recommendation: SalesRecommendation | null): void => {
    setFollowUpError(null);
    setFollowUpRequest({
      recommendation,
      idempotencyKey: createIdempotencyKey(),
    });
  };

  const submitFollowUp = async (input: {
    action: string;
    reason?: string;
    dueAt?: string;
    ownerId?: string | null;
    suggestedMessage?: string;
  }): Promise<void> => {
    if (!followUpRequest) {
      return;
    }
    setFollowUpError(null);
    try {
      await createFollowUp.mutateAsync({
        leadId: lead.id,
        conversationId: conversationId ?? undefined,
        recommendationId: followUpRequest.recommendation?.id,
        idempotencyKey: followUpRequest.idempotencyKey,
        ...input,
      });
      setFollowUpRequest(null);
    } catch (caught) {
      setFollowUpError(errorMessage(caught, 'Não foi possível criar o acompanhamento.'));
    }
  };

  const updateFollowUpStatus = async (
    followUp: SalesFollowUp,
    status: 'COMPLETED' | 'CANCELED',
    result?: string,
  ): Promise<void> => {
    setError(null);
    try {
      await updateFollowUp.mutateAsync({
        id: followUp.id,
        input: { status, result: result?.trim() || undefined },
      });
      setCompletingId(null);
      setCompletionResult('');
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível atualizar o acompanhamento.'));
    }
  };

  const submitReschedule = async (followUp: SalesFollowUp): Promise<void> => {
    if (!rescheduleValue) {
      return;
    }
    setError(null);
    try {
      await updateFollowUp.mutateAsync({
        id: followUp.id,
        input: { dueAt: new Date(rescheduleValue).toISOString() },
      });
      setReschedulingId(null);
      setRescheduleValue('');
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível reagendar o acompanhamento.'));
    }
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
        {settings.isPending || contextQuery.isPending ? (
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
        ) : (
          <>
            {!aiAvailable ? (
              <PanelNotice
                title="IA não configurada"
                description={
                  settings.data?.enabled === false
                    ? 'A IA está desativada para esta organização. O contexto salvo continua disponível, mas novas análises exigem ativação.'
                    : 'Configure um provedor e uma credencial válida para gerar novas análises e recomendações.'
                }
                action={
                  <Button size="sm" asChild>
                    <Link to="/configuracoes?tab=ai">Configurar IA</Link>
                  </Button>
                }
              />
            ) : null}

            <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-[11px] text-muted-foreground">
              {conversationId
                ? conversation
                  ? `Conversa analisada: ${conversation.isGroup ? (conversation.groupName ?? 'Grupo') : (conversation.contactName ?? conversation.contactPhone ?? 'Contato')}`
                  : 'Conversa selecionada. O histórico será carregado pelo servidor.'
                : 'Nenhuma conversa selecionada. O contexto usa apenas os dados comerciais.'}
            </div>

            {error ? (
              <div
                role="alert"
                className="rounded-md border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <p>{error}</p>
                </div>
              </div>
            ) : null}

            {contextQuery.isError ? (
              <PanelNotice
                tone="warning"
                title="Não foi possível carregar o contexto salvo"
                description="Tente novamente em alguns instantes."
                action={
                  <Button variant="outline" size="sm" onClick={() => void contextQuery.refetch()}>
                    <RefreshCw />
                    Tentar novamente
                  </Button>
                }
              />
            ) : null}

            {!context ? (
              <PanelNotice
                title="Analise esta oportunidade"
                description="O copiloto salva o contexto comercial, recomenda a próxima melhor ação e identifica informações que podem melhorar o cadastro do lead."
                action={
                  <div className="flex flex-wrap gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            onClick={() => void handleAnalyze()}
                            disabled={!aiAvailable || analyze.isPending || suggest.isPending}
                          >
                            {analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                            {analyze.isPending ? 'Analisando...' : 'Analisar oportunidade'}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!aiAvailable ? <TooltipContent>Configure a IA para analisar.</TooltipContent> : null}
                    </Tooltip>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleSuggestReply()}
                      disabled={!aiAvailable || suggest.isPending || analyze.isPending}
                    >
                      {suggest.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                      {suggest.isPending ? 'Gerando...' : 'Sugerir resposta'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openFollowUp(null)}
                    >
                      <CalendarClock />
                      Acompanhamento
                    </Button>
                  </div>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">
                    <History />
                    Contexto salvo em {formatDateTime(context.lastAnalyzedAt)}
                  </Badge>
                  {isStale ? (
                    <Badge variant="warning">
                      <AlertTriangle />
                      Contexto desatualizado
                    </Badge>
                  ) : null}
                  {context.latestMessageId === null ? (
                    <Badge variant="outline">Sem histórico de conversa</Badge>
                  ) : null}
                </div>

                {isStale ? (
                  <div className="rounded-md bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
                    {staleMessage(state?.staleReasons ?? [])} Reanalise para atualizar o contexto e a recomendação.
                  </div>
                ) : null}

                <NextActionCard
                  recommendation={state?.nextAction ?? null}
                  canUseMessage={
                    Boolean(conversationId) && context.conversationId === conversationId
                  }
                  pending={decide.isPending || analyze.isPending}
                  onAccept={() => {
                    if (state?.nextAction) void decideRecommendation(state.nextAction, 'ACCEPT');
                  }}
                  onReject={() => {
                    if (state?.nextAction) void decideRecommendation(state.nextAction, 'REJECT');
                  }}
                  onCancel={() => {
                    if (state?.nextAction) void decideRecommendation(state.nextAction, 'CANCEL');
                  }}
                  onFollowUp={() => openFollowUp(state?.nextAction ?? null)}
                  onUseMessage={(message) => {
                    if (conversationId) onUseReply(message, conversationId);
                  }}
                  onAnalyze={() => void handleAnalyze()}
                  analyzing={analyze.isPending}
                />

                <LeadUpdateSuggestions
                  suggestions={state?.leadUpdateSuggestions ?? []}
                  pending={decide.isPending}
                  editingId={editingSuggestionId}
                  editedValue={editedValue}
                  onEdit={(recommendation) => {
                    setEditingSuggestionId(recommendation.id);
                    setEditedValue(recommendation.proposedValue ?? '');
                  }}
                  onEditedValueChange={setEditedValue}
                  onCancelEdit={() => {
                    setEditingSuggestionId(null);
                    setEditedValue('');
                  }}
                  onApply={(recommendation) =>
                    void decideRecommendation(
                      recommendation,
                      'ACCEPT',
                      editingSuggestionId === recommendation.id ? editedValue : undefined,
                    )
                  }
                  onReject={(recommendation) =>
                    void decideRecommendation(recommendation, 'REJECT')
                  }
                />

                {currentReply ? (
                  <ReplyCard
                    title="Resposta sugerida"
                    text={currentReply.text}
                    generatedAt={currentReply.generatedAt}
                    canUse={Boolean(conversationId) && currentReply.conversationId === conversationId}
                    pending={suggest.isPending}
                    onUse={() => insertReply(currentReply)}
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

                <FollowUpsSection
                  followUps={state?.followUps ?? []}
                  conversationId={conversationId}
                  pending={updateFollowUp.isPending}
                  reschedulingId={reschedulingId}
                  rescheduleValue={rescheduleValue}
                  completingId={completingId}
                  completionResult={completionResult}
                  onNew={() => openFollowUp(null)}
                  onUseMessage={(message) => {
                    if (conversationId) onUseReply(message, conversationId);
                  }}
                  onStartComplete={(followUp) => {
                    setCompletingId(followUp.id);
                    setCompletionResult('');
                  }}
                  onCompletionResultChange={setCompletionResult}
                  onCancelComplete={() => {
                    setCompletingId(null);
                    setCompletionResult('');
                  }}
                  onComplete={(followUp) =>
                    void updateFollowUpStatus(followUp, 'COMPLETED', completionResult)
                  }
                  onCancel={(followUp) => void updateFollowUpStatus(followUp, 'CANCELED')}
                  onStartReschedule={(followUp) => {
                    setReschedulingId(followUp.id);
                    setRescheduleValue(toLocalDateTime(followUp.dueAt));
                  }}
                  onRescheduleValueChange={setRescheduleValue}
                  onCancelReschedule={() => {
                    setReschedulingId(null);
                    setRescheduleValue('');
                  }}
                  onReschedule={(followUp) => void submitReschedule(followUp)}
                />

                <ContextDetails context={context} />

                <RecommendationHistory
                  recommendations={state?.recommendations ?? []}
                  followUps={state?.followUps ?? []}
                />

                <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleAnalyze()}
                    disabled={!aiAvailable || analyze.isPending || suggest.isPending}
                  >
                    {analyze.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {analyze.isPending ? 'Reanalisando...' : 'Reanalisar'}
                  </Button>
                  {!currentReply ? (
                    <Button
                      size="sm"
                      onClick={() => void handleSuggestReply()}
                      disabled={!aiAvailable || suggest.isPending}
                    >
                      {suggest.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                      {suggest.isPending ? 'Gerando...' : 'Sugerir resposta'}
                    </Button>
                  ) : null}
                </div>
              </>
            )}

            {!context && (state?.followUps.length ?? 0) > 0 ? (
              <FollowUpsSection
                followUps={state?.followUps ?? []}
                conversationId={conversationId}
                pending={updateFollowUp.isPending}
                reschedulingId={reschedulingId}
                rescheduleValue={rescheduleValue}
                completingId={completingId}
                completionResult={completionResult}
                onNew={() => openFollowUp(null)}
                onUseMessage={(message) => {
                  if (conversationId) onUseReply(message, conversationId);
                }}
                onStartComplete={(followUp) => {
                  setCompletingId(followUp.id);
                  setCompletionResult('');
                }}
                onCompletionResultChange={setCompletionResult}
                onCancelComplete={() => {
                  setCompletingId(null);
                  setCompletionResult('');
                }}
                onComplete={(followUp) =>
                  void updateFollowUpStatus(followUp, 'COMPLETED', completionResult)
                }
                onCancel={(followUp) => void updateFollowUpStatus(followUp, 'CANCELED')}
                onStartReschedule={(followUp) => {
                  setReschedulingId(followUp.id);
                  setRescheduleValue(toLocalDateTime(followUp.dueAt));
                }}
                onRescheduleValueChange={setRescheduleValue}
                onCancelReschedule={() => {
                  setReschedulingId(null);
                  setRescheduleValue('');
                }}
                onReschedule={(followUp) => void submitReschedule(followUp)}
              />
            ) : null}

            {!context && reply ? (
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

            {!context ? (
              <RecommendationHistory
                recommendations={state?.recommendations ?? []}
                followUps={state?.followUps ?? []}
              />
            ) : null}
          </>
        )}
      </div>

      {followUpRequest ? (
        <SalesFollowUpDialog
          key={followUpRequest.idempotencyKey}
          open
          onOpenChange={(open) => {
            if (!open && !createFollowUp.isPending) {
              setFollowUpRequest(null);
              setFollowUpError(null);
            }
          }}
          recommendation={followUpRequest.recommendation}
          members={members.data ?? []}
          defaultOwnerId={lead.ownerId}
          pending={createFollowUp.isPending}
          error={followUpError}
          onSubmit={(input) => void submitFollowUp(input)}
        />
      ) : null}
    </div>
  );
}

function NextActionCard({
  recommendation,
  canUseMessage,
  pending,
  onAccept,
  onReject,
  onCancel,
  onFollowUp,
  onUseMessage,
  onAnalyze,
  analyzing,
}: {
  recommendation: SalesRecommendation | null;
  canUseMessage: boolean;
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
  onFollowUp: () => void;
  onUseMessage: (message: string) => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  if (!recommendation) {
    return (
      <PanelNotice
        title="Nenhuma próxima ação salva"
        description="Reanalise a oportunidade para gerar uma recomendação concreta."
        action={
          <Button size="sm" variant="outline" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Reanalisar
          </Button>
        }
      />
    );
  }

  const actionable =
    recommendation.status === 'RECOMMENDED' || recommendation.status === 'ACCEPTED';

  return (
    <section className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={priorityVariant(recommendation.priority)}>
          Prioridade {priorityLabel(recommendation.priority)}
        </Badge>
        <Badge variant={statusVariant(recommendation.status)}>
          {RECOMMENDATION_STATUS_LABELS[recommendation.status] ?? recommendation.status}
        </Badge>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
          Próxima melhor ação
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">{recommendation.action}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{recommendation.reason}</p>
      {recommendation.expectedOutcome ? (
        <p className="text-xs leading-relaxed">
          <span className="font-medium">Resultado esperado:</span> {recommendation.expectedOutcome}
        </p>
      ) : null}
      {recommendation.missingInformation.length > 0 ? (
        <div className="text-xs">
          <p className="font-medium text-muted-foreground">Ainda falta descobrir</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {recommendation.missingInformation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {recommendation.suggestedDueAt ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarClock className="size-3.5" />
          Prazo sugerido: {formatDateTime(recommendation.suggestedDueAt)}
        </p>
      ) : null}
      {recommendation.suggestedMessage ? (
        <div className="space-y-1 rounded-md border border-border bg-card p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Mensagem sugerida</p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed">{recommendation.suggestedMessage}</p>
          {canUseMessage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUseMessage(recommendation.suggestedMessage as string)}
            >
              Usar mensagem
            </Button>
          ) : null}
        </div>
      ) : null}
      {actionable ? (
        <div className="flex flex-wrap gap-1.5">
          {recommendation.status === 'RECOMMENDED' ? (
            <>
              <Button size="sm" onClick={onAccept} disabled={pending}>
                <Check />
                Aceitar
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={pending}>
                <Ban />
                Rejeitar
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="outline" onClick={onFollowUp} disabled={pending}>
            <CalendarClock />
            Criar acompanhamento
          </Button>
          {recommendation.status === 'ACCEPTED' ? (
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancelar recomendação
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LeadUpdateSuggestions({
  suggestions,
  pending,
  editingId,
  editedValue,
  onEdit,
  onEditedValueChange,
  onCancelEdit,
  onApply,
  onReject,
}: {
  suggestions: SalesRecommendation[];
  pending: boolean;
  editingId: string | null;
  editedValue: string;
  onEdit: (recommendation: SalesRecommendation) => void;
  onEditedValueChange: (value: string) => void;
  onCancelEdit: () => void;
  onApply: (recommendation: SalesRecommendation) => void;
  onReject: (recommendation: SalesRecommendation) => void;
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center gap-1.5">
        <ClipboardCheck className="size-3.5 text-primary" />
        <h3 className="text-xs font-semibold">Sugestões de atualização do lead</h3>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Revise cada sugestão. Nada é alterado no cadastro sem a sua confirmação.
      </p>
      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <div key={suggestion.id} className="space-y-1.5 rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">
                {suggestion.updateField
                  ? UPDATE_FIELD_LABELS[suggestion.updateField]
                  : 'Atualização'}
              </Badge>
            </div>
            {editingId === suggestion.id ? (
              <Textarea
                value={editedValue}
                onChange={(event) => onEditedValueChange(event.target.value)}
                rows={3}
                aria-label="Valor da atualização"
              />
            ) : (
              <p className="whitespace-pre-wrap text-xs">{suggestion.proposedValue}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Evidência:</span> {suggestion.evidence}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => onApply(suggestion)} disabled={pending}>
                <Check />
                Aplicar
              </Button>
              {editingId === suggestion.id ? (
                <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={pending}>
                  Cancelar edição
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onEdit(suggestion)} disabled={pending}>
                  <Pencil />
                  Editar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onReject(suggestion)}
                disabled={pending}
              >
                <Ban />
                Rejeitar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FollowUpsSection({
  followUps,
  conversationId,
  pending,
  reschedulingId,
  rescheduleValue,
  completingId,
  completionResult,
  onNew,
  onUseMessage,
  onStartComplete,
  onCompletionResultChange,
  onCancelComplete,
  onComplete,
  onCancel,
  onStartReschedule,
  onRescheduleValueChange,
  onCancelReschedule,
  onReschedule,
}: {
  followUps: SalesFollowUp[];
  conversationId: string | null;
  pending: boolean;
  reschedulingId: string | null;
  rescheduleValue: string;
  completingId: string | null;
  completionResult: string;
  onNew: () => void;
  onUseMessage: (message: string) => void;
  onStartComplete: (followUp: SalesFollowUp) => void;
  onCompletionResultChange: (value: string) => void;
  onCancelComplete: () => void;
  onComplete: (followUp: SalesFollowUp) => void;
  onCancel: (followUp: SalesFollowUp) => void;
  onStartReschedule: (followUp: SalesFollowUp) => void;
  onRescheduleValueChange: (value: string) => void;
  onCancelReschedule: () => void;
  onReschedule: (followUp: SalesFollowUp) => void;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 text-primary" />
          <h3 className="text-xs font-semibold">Acompanhamentos</h3>
        </div>
        <Button size="sm" variant="outline" onClick={onNew} disabled={pending}>
          <Plus />
          Novo
        </Button>
      </div>
      {followUps.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Nenhum acompanhamento criado. Use uma recomendação ou crie um manualmente.
        </p>
      ) : (
        <div className="space-y-2">
          {followUps.map((followUp) => (
            <div key={followUp.id} className="space-y-1.5 rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={followUpStatusVariant(followUp.status)}>
                  {FOLLOW_UP_STATUS_LABELS[followUp.status]}
                </Badge>
                {followUp.dueAt ? (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="size-3" />
                    {formatDateTime(followUp.dueAt)}
                  </span>
                ) : null}
                {followUp.rescheduleCount > 0 ? (
                  <span className="text-[10px] text-muted-foreground">
                    Reagendado {followUp.rescheduleCount}x
                  </span>
                ) : null}
              </div>
              <p className="text-xs font-medium">{followUp.action}</p>
              {followUp.reason ? (
                <p className="text-[11px] text-muted-foreground">{followUp.reason}</p>
              ) : null}
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <UserRound className="size-3" />
                {followUp.ownerName ?? 'Sem responsável'}
              </p>
              {followUp.suggestedMessage ? (
                <div className="rounded-md bg-surface p-2">
                  <p className="text-[11px] text-muted-foreground">Mensagem preparada</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs">{followUp.suggestedMessage}</p>
                  {conversationId && followUp.conversationId === conversationId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1"
                      onClick={() => onUseMessage(followUp.suggestedMessage as string)}
                    >
                      Usar mensagem
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {followUp.status === 'PENDING' ? (
                reschedulingId === followUp.id ? (
                  <div className="space-y-1.5">
                    <Input
                      type="datetime-local"
                      value={rescheduleValue}
                      onChange={(event) => onRescheduleValueChange(event.target.value)}
                      aria-label="Nova data do acompanhamento"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => onReschedule(followUp)} disabled={pending}>
                        Salvar nova data
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onCancelReschedule}
                        disabled={pending}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : completingId === followUp.id ? (
                  <div className="space-y-1.5">
                    <Textarea
                      value={completionResult}
                      onChange={(event) => onCompletionResultChange(event.target.value)}
                      rows={2}
                      placeholder="Resultado observado ou informado pelo cliente (opcional)"
                      aria-label="Resultado do acompanhamento"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => onComplete(followUp)} disabled={pending}>
                        <Check />
                        Confirmar conclusão
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onCancelComplete}
                        disabled={pending}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => onStartComplete(followUp)} disabled={pending}>
                      <Check />
                      Concluir
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onStartReschedule(followUp)}
                      disabled={pending}
                    >
                      <CalendarClock />
                      Reagendar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onCancel(followUp)}
                      disabled={pending}
                    >
                      <Ban />
                      Cancelar
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  {followUp.completedAt
                    ? `Concluído em ${formatDateTime(followUp.completedAt)}`
                    : followUp.canceledAt
                      ? `Cancelado em ${formatDateTime(followUp.canceledAt)}`
                      : null}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ContextDetails({ context }: { context: SalesPersistedContext }) {
  return (
    <details className="rounded-lg border border-border bg-card p-2.5" open>
      <summary className="cursor-pointer text-xs font-semibold">Contexto comercial salvo</summary>
      <div className="mt-2 space-y-2">
        <Section title="Resumo da oportunidade" icon={Sparkles}>
          <p>{context.summary}</p>
        </Section>
        <Section title="Objetivo comercial" icon={Lightbulb}>
          <p>{context.objective}</p>
        </Section>
        <Section title="Necessidade identificada" icon={Lightbulb}>
          <p>{context.need}</p>
        </Section>
        <Section title="Fatos confirmados" icon={CheckCircle2}>
          <ItemList items={context.knownInformation} empty="Nenhum fato confirmado." />
        </Section>
        <Section title="Hipóteses da IA" icon={CircleHelp} tone="warning">
          <ItemList items={context.hypotheses} empty="Nenhuma hipótese registrada." />
        </Section>
        <Section title="Informações pendentes" icon={CircleHelp}>
          <ItemList items={context.pendingInformation} empty="Nenhuma lacuna relevante." />
        </Section>
        <Section title="Próxima pergunta recomendada" icon={MessageCircleQuestion} highlighted>
          <p>{context.nextQuestion}</p>
        </Section>
        <Section title="Por que esta abordagem" icon={Lightbulb}>
          <p>{context.rationale}</p>
        </Section>
      </div>
    </details>
  );
}

function RecommendationHistory({
  recommendations,
  followUps,
}: {
  recommendations: SalesRecommendation[];
  followUps: SalesFollowUp[];
}) {
  if (recommendations.length === 0 && followUps.length === 0) {
    return null;
  }

  return (
    <details className="rounded-lg border border-border bg-card p-2.5">
      <summary className="cursor-pointer text-xs font-semibold">
        Histórico de recomendações e decisões
      </summary>
      <div className="mt-2 space-y-1.5">
        {recommendations.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nenhuma recomendação registrada.</p>
        ) : (
          recommendations.map((recommendation) => (
            <div
              key={recommendation.id}
              className="rounded-md border border-border px-2 py-1.5 text-[11px]"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={statusVariant(recommendation.status)}>
                  {RECOMMENDATION_STATUS_LABELS[recommendation.status] ?? recommendation.status}
                </Badge>
                <span className="text-muted-foreground">
                  {recommendation.kind === 'NEXT_ACTION'
                    ? 'Próxima ação'
                    : UPDATE_FIELD_LABELS[recommendation.updateField ?? 'NOTES']}
                </span>
                {recommendation.decidedAt ? (
                  <span className="text-muted-foreground">
                    · {formatDateTime(recommendation.decidedAt)}
                    {recommendation.decidedByName ? ` · ${recommendation.decidedByName}` : ''}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-foreground">
                {recommendation.kind === 'NEXT_ACTION'
                  ? recommendation.action
                  : recommendation.proposedValue}
              </p>
            </div>
          ))
        )}
      </div>
    </details>
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
  tone = 'default',
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  highlighted?: boolean;
  tone?: 'default' | 'warning';
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'space-y-1 rounded-md border p-2.5',
        highlighted
          ? 'border-primary/30 bg-primary/5'
          : tone === 'warning'
            ? 'border-warning/25 bg-warning/5'
            : 'border-border bg-card',
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

function ItemList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
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

function summarizeContext(context: SalesPersistedContext): string {
  return [
    `Resumo: ${context.summary}`,
    `Objetivo: ${context.objective}`,
    `Necessidade: ${context.need}`,
    `Fatos confirmados: ${context.knownInformation.join('; ') || 'nenhum'}`,
    `Hipóteses: ${context.hypotheses.join('; ') || 'nenhuma'}`,
    `Informações pendentes: ${context.pendingInformation.join('; ') || 'nenhuma'}`,
    `Próxima pergunta: ${context.nextQuestion}`,
    `Justificativa: ${context.rationale}`,
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

function priorityVariant(priority: string): 'danger' | 'warning' | 'secondary' {
  if (priority === 'HIGH') return 'danger';
  if (priority === 'MEDIUM') return 'warning';
  return 'secondary';
}

function priorityLabel(priority: string): string {
  if (priority === 'HIGH') return 'alta';
  if (priority === 'MEDIUM') return 'média';
  return 'baixa';
}

function statusVariant(
  status: string,
): 'secondary' | 'success' | 'warning' | 'danger' | 'outline' {
  if (status === 'EXECUTED' || status === 'ACCEPTED') return 'success';
  if (status === 'RECOMMENDED') return 'warning';
  if (status === 'REJECTED' || status === 'CANCELED') return 'outline';
  return 'secondary';
}

function followUpStatusVariant(status: string): 'success' | 'warning' | 'outline' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'PENDING') return 'warning';
  return 'outline';
}

function staleMessage(reasons: string[]): string {
  if (reasons.includes('conversation_changed')) {
    return 'A conversa selecionada mudou desde a última análise.';
  }
  if (reasons.includes('new_messages')) {
    return 'Chegaram novas mensagens depois da última análise.';
  }
  if (reasons.includes('lead_updated')) {
    return 'Os dados da oportunidade mudaram depois da última análise.';
  }
  return 'O contexto salvo pode estar desatualizado.';
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
