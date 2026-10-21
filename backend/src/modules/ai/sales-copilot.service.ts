import { Injectable } from '@nestjs/common';
import { MessageDirection, MessageType, Prisma } from '@prisma/client';
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
  SALES_COPILOT_PROMPT_VERSION,
  SALES_MAX_HISTORY_CHARS,
  SALES_MAX_HISTORY_MESSAGES,
  SALES_MAX_OUTPUT_TOKENS,
  type SalesAnalysisView,
  type SalesContextSummary,
  type SalesCopilotContext,
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

      return {
        ...payload,
        provider: result.provider,
        model: result.model,
        generatedAt: new Date().toISOString(),
        promptVersion: SALES_COPILOT_PROMPT_VERSION,
        context: loaded.context.summary,
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

  private async loadContext(
    tenantId: string,
    leadId: string,
    conversationId?: string,
  ): Promise<LoadedContext> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      include: LEAD_INCLUDE,
    });
    if (!lead) {
      throw new LeadNotFoundError();
    }

    const conversation = conversationId
      ? await this.loadConversation(tenantId, lead, conversationId)
      : null;

    const messages = conversation
      ? await this.prisma.message.findMany({
          where: { tenantId, conversationId: conversation.id },
          orderBy: { occurredAt: 'desc' },
          take: SALES_MAX_HISTORY_MESSAGES + 1,
          select: MESSAGE_SELECT,
        })
      : [];

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
      },
    };
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
