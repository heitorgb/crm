import { Injectable } from '@nestjs/common';
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  Prisma,
} from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import type {
  ListComplianceRequestsQueryDto,
  RectifyLeadDto,
} from './dto/compliance.dto.js';
import {
  ComplianceRequestNotFoundError,
  DataSubjectNotFoundError,
  LegalHoldActiveError,
} from './compliance.errors.js';

export interface AnonymizationResult {
  leadId: string;
  conversations: number;
  messages: number;
  sessions: number;
  analyses: number;
  tasks: number;
  deals: number;
}

export interface ComplianceRequestView {
  id: string;
  type: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  leadId: string | null;
  sessionId: string | null;
  requestedBy: string | null;
  subjectContact: string | null;
  details: Prisma.JsonValue;
  response: Prisma.JsonValue | null;
  notes: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

@Injectable()
export class PersonalDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly activities: ActivitiesService,
  ) {}

  async collect(leadId: string) {
    const { tenantId } = this.tenantContext.requireContext();
    return this.collectForTenant(tenantId, leadId);
  }

  async collectForTenant(tenantId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        tags: { include: { tag: { select: { id: true, name: true } } } },
        conversations: {
          orderBy: { createdAt: 'asc' },
          include: { messages: { orderBy: { occurredAt: 'asc' } } },
        },
        sessions: { orderBy: { startedAt: 'asc' }, include: { analyses: true } },
        tasks: {
          select: { id: true, title: true, description: true, status: true, dueAt: true },
        },
        deals: { select: { id: true, title: true, value: true, status: true } },
      },
    });

    if (!lead) {
      throw new DataSubjectNotFoundError();
    }

    return {
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        source: lead.source,
        status: lead.status,
        anonymizedAt: lead.anonymizedAt,
        consentRevokedAt: lead.consentRevokedAt,
        oppositionAt: lead.oppositionAt,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      },
      tags: lead.tags.map((item) => item.tag),
      conversations: lead.conversations.map((conversation) => ({
        id: conversation.id,
        status: conversation.status,
        externalContactId: conversation.externalContactId,
        lastMessageAt: conversation.lastMessageAt,
        messages: conversation.messages.map((message) => ({
          id: message.id,
          direction: message.direction,
          type: message.type,
          content: message.content,
          occurredAt: message.occurredAt,
        })),
      })),
      qualification: lead.sessions.map((session) => ({
        id: session.id,
        status: session.status,
        profileVersion: session.profileVersion,
        collectedData: session.collectedData,
        transcript: session.transcript,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        analyses: session.analyses.map((analysis) => ({
          id: analysis.id,
          outcome: analysis.outcome,
          score: analysis.score,
          qualificationLevel: analysis.qualificationLevel,
          summary: analysis.summary,
          qualificationReasons: analysis.qualificationReasons,
          createdAt: analysis.createdAt,
        })),
      })),
      tasks: lead.tasks,
      deals: lead.deals,
    };
  }

  async rectify(leadId: string, dto: RectifyLeadDto) {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireLead(tenantId, leadId);

    const data: Prisma.LeadUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = normalize(dto.name);
    if (dto.phone !== undefined) data.phone = normalize(dto.phone);
    if (dto.email !== undefined) data.email = normalize(dto.email)?.toLowerCase() ?? null;

    try {
      await this.prisma.lead.update({ where: { id: leadId }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('DATA_SUBJECT_CONFLICT', 'Phone already used by another lead', 409);
      }
      throw error;
    }

    await this.record({
      type: DataSubjectRequestType.RECTIFICATION,
      status: DataSubjectRequestStatus.COMPLETED,
      leadId,
      details: { fields: Object.keys(data) },
    });

    await this.activities.record({ entity: 'lead', entityId: leadId, action: 'rectified' });
    return this.collect(leadId);
  }

  async erase(leadId: string, confirm: boolean): Promise<AnonymizationResult> {
    if (!confirm) {
      throw new AppException('CONFIRMATION_REQUIRED', 'Erasure requires explicit confirmation', 400);
    }

    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.anonymizeLead(tenantId, leadId, { recordRequest: false });

    await this.record({
      type: DataSubjectRequestType.ERASURE,
      status: DataSubjectRequestStatus.COMPLETED,
      leadId,
      details: { mode: 'anonymization', affected: result },
    });

    return result;
  }

  async revokeConsent(leadId: string, reason?: string) {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireLead(tenantId, leadId);
    const now = new Date();

    await this.prisma.lead.update({ where: { id: leadId }, data: { consentRevokedAt: now } });
    await this.record({
      type: DataSubjectRequestType.CONSENT_REVOCATION,
      status: DataSubjectRequestStatus.COMPLETED,
      leadId,
      notes: reason ?? null,
    });

    return { leadId, consentRevokedAt: now };
  }

  async oppose(leadId: string, reason?: string) {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireLead(tenantId, leadId);
    const now = new Date();

    await this.prisma.lead.update({ where: { id: leadId }, data: { oppositionAt: now } });
    await this.record({
      type: DataSubjectRequestType.OPPOSITION,
      status: DataSubjectRequestStatus.COMPLETED,
      leadId,
      notes: reason ?? null,
    });

    return { leadId, oppositionAt: now };
  }

  async anonymizeLead(
    tenantId: string,
    leadId: string,
    options: { recordRequest?: boolean } = {},
  ): Promise<AnonymizationResult> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true, legalHold: true },
    });
    if (!lead) {
      throw new DataSubjectNotFoundError();
    }
    if (lead.legalHold) {
      throw new LegalHoldActiveError();
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const conversations = await tx.conversation.findMany({
        where: { tenantId, leadId },
        select: { id: true },
      });
      const conversationIds = conversations.map((conversation) => conversation.id);

      const messages = await tx.message.updateMany({
        where: { tenantId, conversationId: { in: conversationIds } },
        data: { content: null, metadata: {}, externalMessageId: null },
      });
      const updatedConversations = await tx.conversation.updateMany({
        where: { tenantId, id: { in: conversationIds } },
        data: { externalContactId: null, subject: null, legalHold: false },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: {
          name: null,
          phone: null,
          email: null,
          anonymizedAt: new Date(),
          legalHold: false,
        },
      });

      const sessions = await tx.leadQualificationSession.updateMany({
        where: { tenantId, leadId },
        data: {
          collectedData: {},
          transcript: [],
          handoffReason: null,
          reviewNotes: null,
        },
      });
      const analyses = await tx.leadAnalysis.updateMany({
        where: { tenantId, leadId },
        data: {
          summary: 'Dados pessoais anonimizados',
          collectedData: {},
          strengths: [],
          risks: [],
          missingInformation: [],
          recommendedNextStep: null,
          qualificationReasons: [],
        },
      });
      const tasks = await tx.task.updateMany({
        where: { tenantId, leadId },
        data: { title: 'Tarefa anonimizada', description: null },
      });
      const deals = await tx.deal.updateMany({
        where: { tenantId, leadId },
        data: { title: 'Negócio anonimizado', description: null },
      });

      return {
        leadId,
        conversations: updatedConversations.count,
        messages: messages.count,
        sessions: sessions.count,
        analyses: analyses.count,
        tasks: tasks.count,
        deals: deals.count,
      };
    });

    await this.activities.record({
      entity: 'lead',
      entityId: leadId,
      action: 'anonymized',
      metadata: { ...result },
    });

    if (options.recordRequest !== false) {
      await this.record({
        type: DataSubjectRequestType.ERASURE,
        status: DataSubjectRequestStatus.COMPLETED,
        leadId,
        details: { mode: 'anonymization', affected: result },
      });
    }

    return result;
  }

  async listRequests(
    query: ListComplianceRequestsQueryDto,
  ): Promise<PageResult<ComplianceRequestView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.DataSubjectRequestWhereInput = { tenantId };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.leadId) where.leadId = query.leadId;

    const [total, requests] = await this.prisma.$transaction([
      this.prisma.dataSubjectRequest.count({ where }),
      this.prisma.dataSubjectRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(requests.map(toRequestView), total, query.page, query.perPage);
  }

  async findRequest(id: string): Promise<ComplianceRequestView> {
    const { tenantId } = this.tenantContext.requireContext();
    const request = await this.prisma.dataSubjectRequest.findFirst({ where: { id, tenantId } });
    if (!request) {
      throw new ComplianceRequestNotFoundError();
    }
    return toRequestView(request);
  }

  async record(input: {
    type: DataSubjectRequestType;
    status: DataSubjectRequestStatus;
    leadId?: string | null;
    sessionId?: string | null;
    details?: Record<string, unknown>;
    response?: Record<string, unknown> | null;
    notes?: string | null;
  }): Promise<void> {
    const { tenantId, userId } = this.tenantContext.requireContext();
    await this.prisma.dataSubjectRequest.create({
      data: {
        tenantId,
        type: input.type,
        status: input.status,
        leadId: input.leadId ?? null,
        sessionId: input.sessionId ?? null,
        requestedBy: userId,
        details: (input.details ?? {}) as Prisma.InputJsonValue,
        response: (input.response ?? undefined) as Prisma.InputJsonValue | undefined,
        notes: input.notes ?? null,
        completedAt: input.status === DataSubjectRequestStatus.COMPLETED ? new Date() : null,
      },
    });
  }

  private async requireLead(tenantId: string, leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true },
    });
    if (!lead) {
      throw new DataSubjectNotFoundError();
    }
  }
}

function toRequestView(request: Prisma.DataSubjectRequestGetPayload<object>): ComplianceRequestView {
  return {
    id: request.id,
    type: request.type,
    status: request.status,
    leadId: request.leadId,
    sessionId: request.sessionId,
    requestedBy: request.requestedBy,
    subjectContact: request.subjectContact,
    details: request.details,
    response: request.response,
    notes: request.notes,
    createdAt: request.createdAt,
    completedAt: request.completedAt,
  };
}

function normalize(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
