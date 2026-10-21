import { Injectable } from '@nestjs/common';
import {
  LeadRecommendationKind,
  LeadRecommendationStatus,
  LeadUpdateField,
  MessageDirection,
  MessageType,
  Prisma,
} from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ModuleDisabledError } from '../modules/modules.errors.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { ModulesService } from '../modules/modules.service.js';
import { LeadNotFoundError } from '../leads/leads.errors.js';
import { ConversationNotFoundError } from '../conversations/conversations.errors.js';
import { AiSalesConversationMismatchError, AiSalesRequestInProgressError } from './ai.errors.js';
import { AiExecutionService } from './ai-execution.service.js';
import type {
  AnalyzeSalesOpportunityDto,
  SuggestSalesReplyDto,
} from './dto/sales-copilot.dto.js';
import {
  FOLLOW_UP_INCLUDE,
  RECOMMENDATION_INCLUDE,
  toContextView,
  toFollowUpView,
  toRecommendationView,
} from './sales-copilot.mappers.js';
import {
  SALES_COPILOT_PROMPT_VERSION,
  SALES_MAX_HISTORY_CHARS,
  SALES_MAX_HISTORY_MESSAGES,
  SALES_MAX_OUTPUT_TOKENS,
  type SalesAnalysisPayload,
  type SalesAnalysisView,
  type SalesContextSummary,
  type SalesCopilotContext,
  type SalesCopilotStateView,
  type SalesReplyView,
} from './sales-copilot.models.js';
import { parseSalesAnalysis, parseSalesReply } from './sales-copilot.parser.js';
import {
  buildSalesAnalysisSystemPrompt,
  buildSalesReplySystemPrompt,
  buildSalesUserContent,
} from './sales-copilot.prompt.js';

const LEAD_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true } },
  pipeline: { select: { name: true } },
  stage: { select: { name: true } },
  owner: { select: { user: { select: { name: true } } } },
  tags: { select: { tag: { select: { name: true } } } },
} satisfies Prisma.LeadInclude;

type LeadRow = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

const CONVERSATION_SELECT = {
  id: true,
  status: true,
  contactId: true,
  isGroup: true,
  groupName: true,
  lastMessageAt: true,
  instance: { select: { name: true } },
} satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  type: true,
  content: true,
  senderName: true,
  occurredAt: true,
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

const UPDATE_FIELD_LABELS: Record<LeadUpdateField, string> = {
  NEED: 'necessidade',
  PRODUCT: 'produto ou serviço de interesse',
  BUDGET: 'orçamento informado',
  DEADLINE: 'prazo desejado',
  USERS: 'número de usuários ou volume',
  REQUIREMENTS: 'requisitos técnicos',
  OBJECTION: 'objeção',
  STAGE: 'etapa do pipeline',
  LOSS_REASON: 'motivo de perda',
  NOTES: 'observação comercial',
};

interface LoadedContext {
  context: SalesCopilotContext;
}

@Injectable()
export class SalesCopilotService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly execution: AiExecutionService,
    private readonly modules: ModulesService,
  ) {}

  async analyze(dto: AnalyzeSalesOpportunityDto): Promise<SalesAnalysisView> {
    return this.withLock(async (tenantId) => {
      const loaded = await this.loadContext(tenantId, dto.leadId, dto.conversationId);
      const settings = await this.execution.resolveSettings();
      const result = await this.execution.complete(
        {
          systemPrompt: buildSalesAnalysisSystemPrompt(),
          userContent: buildSalesUserContent(loaded.context),
          maxTokens: SALES_MAX_OUTPUT_TOKENS,
        },
        settings,
      );
      const payload = parseSalesAnalysis(result.text);
      const generatedAt = new Date();

      await this.persistAnalysis(
        tenantId,
        loaded.context,
        payload,
        result.provider,
        result.model,
        generatedAt,
      );
      const state = await this.getState(dto.leadId, dto.conversationId);

      return {
        ...payload,
        provider: result.provider,
        model: result.model,
        generatedAt: generatedAt.toISOString(),
        promptVersion: SALES_COPILOT_PROMPT_VERSION,
        context: loaded.context.summary,
        state,
      };
    });
  }

  async suggestReply(dto: SuggestSalesReplyDto): Promise<SalesReplyView> {
    return this.withLock(async (tenantId) => {
      const loaded = await this.loadContext(tenantId, dto.leadId, dto.conversationId);
      const settings = await this.execution.resolveSettings();
      const result = await this.execution.complete(
        {
          systemPrompt: buildSalesReplySystemPrompt(settings.formality),
          userContent: buildSalesUserContent(loaded.context, {
            previousAnalysis: dto.previousAnalysis,
          }),
          maxTokens: SALES_MAX_OUTPUT_TOKENS,
        },
        settings,
      );
      const reply = parseSalesReply(result.text);

      return {
        reply,
        provider: result.provider,
        model: result.model,
        generatedAt: new Date().toISOString(),
        promptVersion: SALES_COPILOT_PROMPT_VERSION,
        context: loaded.context.summary,
      };
    });
  }

  async getState(leadId: string, conversationId?: string): Promise<SalesCopilotStateView> {
    const { tenantId } = this.tenantContext.requireContext();
    const lead = await this.requireLead(tenantId, leadId);
    if (conversationId) {
      await this.loadConversation(tenantId, lead, conversationId);
    }

    const [contextRow, recommendationRows, followUpRows] = await Promise.all([
      this.prisma.leadCommercialContext.findFirst({ where: { tenantId, leadId } }),
      this.prisma.leadRecommendation.findMany({
        where: { tenantId, leadId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: RECOMMENDATION_INCLUDE,
      }),
      this.prisma.leadFollowUp.findMany({
        where: { tenantId, leadId },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
        take: 50,
        include: FOLLOW_UP_INCLUDE,
      }),
    ]);

    const recommendations = recommendationRows.map(toRecommendationView);
    const context = contextRow ? toContextView(contextRow) : null;
    const currentRecommendations = contextRow
      ? recommendationRows.filter((item) => item.analysisVersion === contextRow.analysisVersion)
      : [];
    const nextAction = currentRecommendations.find(
      (item) => item.kind === LeadRecommendationKind.NEXT_ACTION,
    );
    const leadUpdateSuggestions = currentRecommendations.filter(
      (item) =>
        item.kind === LeadRecommendationKind.LEAD_UPDATE &&
        item.status === LeadRecommendationStatus.RECOMMENDED,
    );

    const staleReasons = await this.resolveStaleReasons(tenantId, lead, contextRow, conversationId);

    return {
      context,
      stale: staleReasons.length > 0,
      staleReasons,
      nextAction: nextAction ? toRecommendationView(nextAction) : null,
      leadUpdateSuggestions: leadUpdateSuggestions.map(toRecommendationView),
      recommendations,
      followUps: followUpRows.map(toFollowUpView),
    };
  }

  private async persistAnalysis(
    tenantId: string,
    loaded: SalesCopilotContext,
    payload: SalesAnalysisPayload,
    provider: string,
    model: string,
    generatedAt: Date,
  ): Promise<void> {
    const opportunity = loaded.opportunity;
    const summary = loaded.summary;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${opportunity.id}, 0))`;
      const contextRow = await tx.leadCommercialContext.upsert({
        where: { leadId: opportunity.id },
        create: {
          tenant: { connect: { id: tenantId } },
          lead: { connect: { id: opportunity.id } },
          ...(summary.conversationId
            ? { conversation: { connect: { id: summary.conversationId } } }
            : {}),
          summary: payload.summary,
          objective: payload.objective,
          need: payload.need,
          confirmedFacts: payload.knownInformation as Prisma.InputJsonValue,
          hypotheses: payload.hypotheses as Prisma.InputJsonValue,
          pendingInformation: payload.pendingInformation as Prisma.InputJsonValue,
          nextQuestion: payload.nextQuestion,
          suggestedReply: payload.suggestedReply,
          rationale: payload.rationale,
          provider,
          model,
          promptVersion: SALES_COPILOT_PROMPT_VERSION,
          latestMessageId: summary.latestMessageId,
          latestMessageAt: summary.latestMessageAt ? new Date(summary.latestMessageAt) : null,
          leadUpdatedAt: new Date(summary.leadUpdatedAt),
          lastAnalyzedAt: generatedAt,
        },
        update: {
          conversation: summary.conversationId
            ? { connect: { id: summary.conversationId } }
            : { disconnect: true },
          summary: payload.summary,
          objective: payload.objective,
          need: payload.need,
          confirmedFacts: payload.knownInformation as Prisma.InputJsonValue,
          hypotheses: payload.hypotheses as Prisma.InputJsonValue,
          pendingInformation: payload.pendingInformation as Prisma.InputJsonValue,
          nextQuestion: payload.nextQuestion,
          suggestedReply: payload.suggestedReply,
          rationale: payload.rationale,
          provider,
          model,
          promptVersion: SALES_COPILOT_PROMPT_VERSION,
          analysisVersion: { increment: 1 },
          latestMessageId: summary.latestMessageId,
          latestMessageAt: summary.latestMessageAt ? new Date(summary.latestMessageAt) : null,
          leadUpdatedAt: new Date(summary.leadUpdatedAt),
          lastAnalyzedAt: generatedAt,
        },
      });

      await tx.leadRecommendation.updateMany({
        where: {
          tenantId,
          leadId: opportunity.id,
          analysisVersion: { lt: contextRow.analysisVersion },
          status: LeadRecommendationStatus.RECOMMENDED,
        },
        data: {
          status: LeadRecommendationStatus.CANCELED,
          decidedAt: generatedAt,
          result: { reason: 'superseded_by_new_analysis' } satisfies Prisma.InputJsonObject,
        },
      });

      await tx.leadRecommendation.create({
        data: {
          tenantId,
          leadId: opportunity.id,
          conversationId: summary.conversationId,
          contextId: contextRow.id,
          analysisVersion: contextRow.analysisVersion,
          kind: LeadRecommendationKind.NEXT_ACTION,
          priority: payload.nextAction.priority,
          action: payload.nextAction.action,
          reason: payload.nextAction.reason,
          expectedOutcome: payload.nextAction.expectedOutcome,
          missingInformation: payload.nextAction.missingInformation as Prisma.InputJsonValue,
          suggestedDueAt: parseOptionalDate(payload.nextAction.suggestedDueAt),
          suggestedMessage: normalizeNullable(payload.nextAction.suggestedMessage),
        },
      });

      const seenFields = new Set<LeadUpdateField>();
      for (const suggestion of payload.leadUpdateSuggestions) {
        const field = suggestion.field as LeadUpdateField;
        if (seenFields.has(field)) {
          continue;
        }
        seenFields.add(field);
        await tx.leadRecommendation.create({
          data: {
            tenantId,
            leadId: opportunity.id,
            conversationId: summary.conversationId,
            contextId: contextRow.id,
            analysisVersion: contextRow.analysisVersion,
            kind: LeadRecommendationKind.LEAD_UPDATE,
            priority: 'MEDIUM',
            action: `Atualizar ${UPDATE_FIELD_LABELS[field]}`,
            reason: suggestion.evidence,
            expectedOutcome: 'Manter o cadastro comercial alinhado ao que o cliente informou.',
            updateField: field,
            proposedValue: suggestion.proposedValue,
            evidence: suggestion.evidence,
          },
        });
      }
    });
  }

  private async resolveStaleReasons(
    tenantId: string,
    lead: LeadRow,
    context: Prisma.LeadCommercialContextGetPayload<object> | null,
    conversationId?: string,
  ): Promise<string[]> {
    if (!context) {
      return [];
    }

    const reasons: string[] = [];
    const currentConversationId = conversationId ?? null;

    if (context.conversationId !== currentConversationId) {
      reasons.push('conversation_changed');
    }

    if (context.conversationId) {
      const latest = await this.prisma.message.findFirst({
        where: { tenantId, conversationId: context.conversationId },
        orderBy: { occurredAt: 'desc' },
        select: { id: true },
      });
      if (latest?.id !== context.latestMessageId) {
        reasons.push('new_messages');
      }
    }

    if (lead.updatedAt.getTime() > context.leadUpdatedAt.getTime()) {
      reasons.push('lead_updated');
    }

    return reasons;
  }

  private async loadContext(
    tenantId: string,
    leadId: string,
    conversationId?: string,
  ): Promise<LoadedContext> {
    const lead = await this.requireLead(tenantId, leadId);
    const conversation = conversationId
      ? await this.loadConversation(tenantId, lead, conversationId)
      : null;

    const [messages, previousContext, previousRecommendations, previousFollowUps] =
      await Promise.all([
        conversation
          ? this.prisma.message.findMany({
              where: { tenantId, conversationId: conversation.id },
              orderBy: { occurredAt: 'desc' },
              take: SALES_MAX_HISTORY_MESSAGES + 1,
              select: MESSAGE_SELECT,
            })
          : Promise.resolve([]),
        this.prisma.leadCommercialContext.findFirst({ where: { tenantId, leadId } }),
        this.prisma.leadRecommendation.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            kind: true,
            status: true,
            action: true,
            proposedValue: true,
            decidedAt: true,
          },
        }),
        this.prisma.leadFollowUp.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { action: true, status: true, dueAt: true },
        }),
      ]);

    const history = buildHistory(messages);
    const summary: SalesContextSummary = {
      leadId: lead.id,
      conversationId: conversation?.id ?? null,
      messageCount: history.included,
      latestMessageId: messages[0]?.id ?? null,
      latestMessageAt: messages[0]?.occurredAt.toISOString() ?? null,
      leadUpdatedAt: lead.updatedAt.toISOString(),
      historyTruncated: history.truncated,
      mediaWithoutText: history.mediaWithoutText,
    };

    return {
      context: {
        opportunity: toOpportunityContext(lead),
        conversation: conversation ? toConversationContext(conversation) : null,
        transcript: history.transcript,
        summary,
        priorActions: {
          previousContext: previousContext
            ? {
                objective: previousContext.objective,
                knownInformation: stringItems(previousContext.confirmedFacts),
                hypotheses: stringItems(previousContext.hypotheses),
                pendingInformation: stringItems(previousContext.pendingInformation),
                nextQuestion: previousContext.nextQuestion,
              }
            : null,
          recommendations: previousRecommendations.map((item) => ({
            kind: item.kind,
            status: item.status,
            action: item.action,
            proposedValue: item.proposedValue,
            decidedAt: item.decidedAt?.toISOString() ?? null,
          })),
          followUps: previousFollowUps.map((item) => ({
            action: item.action,
            status: item.status,
            dueAt: item.dueAt?.toISOString() ?? null,
          })),
        },
      },
    };
  }

  private async requireLead(tenantId: string, leadId: string): Promise<LeadRow> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      include: LEAD_INCLUDE,
    });
    if (!lead) {
      throw new LeadNotFoundError();
    }
    return lead;
  }

  private async loadConversation(
    tenantId: string,
    lead: LeadRow,
    conversationId: string,
  ): Promise<ConversationRow> {
    if (!(await this.modules.isEnabled(tenantId, MODULE_KEYS.ATTENDANCE))) {
      throw new ModuleDisabledError(MODULE_KEYS.ATTENDANCE);
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, deletedAt: null },
      select: CONVERSATION_SELECT,
    });
    if (!conversation) {
      throw new ConversationNotFoundError();
    }
    if (!conversation.contactId || conversation.contactId !== lead.contactId) {
      throw new AiSalesConversationMismatchError();
    }

    return conversation;
  }

  private async withLock<T>(run: (tenantId: string) => Promise<T>): Promise<T> {
    const { tenantId, userId } = this.tenantContext.requireContext();
    const lockKey = `${tenantId}:${userId}`;

    if (this.inFlight.has(lockKey)) {
      throw new AiSalesRequestInProgressError();
    }

    this.inFlight.add(lockKey);
    try {
      return await run(tenantId);
    } finally {
      this.inFlight.delete(lockKey);
    }
  }
}

function buildHistory(messages: MessageRow[]): {
  transcript: string;
  included: number;
  truncated: boolean;
  mediaWithoutText: number;
} {
  if (messages.length === 0) {
    return {
      transcript: '<sem histórico de mensagens>',
      included: 0,
      truncated: false,
      mediaWithoutText: 0,
    };
  }

  const limited = messages.slice(0, SALES_MAX_HISTORY_MESSAGES);
  const selected: string[] = [];
  let usedChars = 0;
  let mediaWithoutText = 0;
  let droppedByChars = false;

  for (const message of limited) {
    const hasText = typeof message.content === 'string' && message.content.trim().length > 0;
    if (!hasText && message.type !== MessageType.TEXT) {
      mediaWithoutText += 1;
    }

    const line = JSON.stringify({
      at: message.occurredAt.toISOString(),
      from:
        message.direction === MessageDirection.INBOUND
          ? 'CLIENTE'
          : (message.senderName ?? 'ATENDENTE'),
      type: message.type,
      text: hasText ? message.content : null,
      note: hasText ? undefined : 'conteúdo de mídia não transcrito',
    });

    if (usedChars + line.length + 1 > SALES_MAX_HISTORY_CHARS) {
      droppedByChars = true;
      break;
    }

    selected.push(line);
    usedChars += line.length + 1;
  }

  selected.reverse();

  return {
    transcript: selected.join('\n'),
    included: selected.length,
    truncated: messages.length > SALES_MAX_HISTORY_MESSAGES || droppedByChars,
    mediaWithoutText,
  };
}

function toOpportunityContext(lead: LeadRow) {
  return {
    id: lead.id,
    title: lead.title,
    status: lead.status,
    pipeline: lead.pipeline.name,
    stage: lead.stage.name,
    valueCents: lead.valueCents,
    ownerName: lead.owner?.user.name ?? null,
    source: lead.source,
    tags: lead.tags.map(({ tag }) => tag.name),
    notes: lead.notes,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    contactName: lead.contact.name,
    contactPhone: lead.contact.phone,
  };
}

function toConversationContext(conversation: ConversationRow) {
  return {
    id: conversation.id,
    status: conversation.status,
    instanceName: conversation.instance.name,
    isGroup: conversation.isGroup,
    groupName: conversation.groupName,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
  };
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringItems(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
