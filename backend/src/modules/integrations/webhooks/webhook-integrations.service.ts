import { Injectable } from '@nestjs/common';
import { Prisma, WhatsAppInstanceStatus } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../../common/http/pagination.js';
import { TenantContextService } from '../../../common/tenant-context/tenant-context.service.js';
import { isGroupJid } from '../../../common/whatsapp/jid.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { EvolutionClient } from '../../whatsapp/evolution/evolution.client.js';
import type {
  CreateWebhookIntegrationDto,
  ListWebhookIntegrationsQueryDto,
  UpdateWebhookIntegrationDto,
} from './dto/webhook.dto.js';
import { WEBHOOK_GROUP_JID_PATTERN } from './dto/webhook.dto.js';
import {
  WebhookGroupInvalidError,
  WebhookGroupNotFoundError,
  WebhookInstanceUnavailableError,
  WebhookIntegrationNotFoundError,
} from './webhooks.errors.js';
import { generateWebhookSecret } from './webhook-secret.js';

export interface WebhookIntegrationView {
  id: string;
  name: string;
  whatsappInstanceId: string;
  instanceName: string;
  instanceStatus: WhatsAppInstanceStatus;
  groupJid: string;
  groupName: string | null;
  active: boolean;
  secretHint: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookIntegrationWithSecret extends WebhookIntegrationView {
  secret: string;
}

export interface WebhookGroupView {
  jid: string;
  name: string | null;
  size: number | null;
}

const INSTANCE_SELECT = {
  id: true,
  name: true,
  instanceName: true,
  status: true,
  active: true,
} satisfies Prisma.WhatsAppInstanceSelect;

const INTEGRATION_INCLUDE = {
  instance: { select: INSTANCE_SELECT },
} satisfies Prisma.WebhookIntegrationInclude;

type PrismaIntegration = Prisma.WebhookIntegrationGetPayload<{
  include: typeof INTEGRATION_INCLUDE;
}>;

@Injectable()
export class WebhookIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly evolution: EvolutionClient,
  ) {}

  async list(
    query: ListWebhookIntegrationsQueryDto,
  ): Promise<PageResult<WebhookIntegrationView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.WebhookIntegrationWhereInput = { tenantId, deletedAt: null };

    if (query.active !== undefined) where.active = query.active;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { groupName: { contains: query.search, mode: 'insensitive' } },
        { groupJid: { contains: query.search, mode: 'insensitive' } },
        { instance: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [total, integrations] = await this.prisma.$transaction([
      this.prisma.webhookIntegration.count({ where }),
      this.prisma.webhookIntegration.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: INTEGRATION_INCLUDE,
      }),
    ]);

    return buildPage(integrations.map(toView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<WebhookIntegrationView> {
    return toView(await this.requireIntegration(id));
  }

  async create(dto: CreateWebhookIntegrationDto): Promise<WebhookIntegrationWithSecret> {
    const { tenantId } = this.tenantContext.requireContext();
    const instance = await this.requireSendableInstance(tenantId, dto.whatsappInstanceId);
    const group = await this.resolveGroup(instance.instanceName, dto.groupJid);
    const generated = generateWebhookSecret();

    const integration = await this.prisma.webhookIntegration.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        whatsappInstanceId: instance.id,
        groupJid: group.groupJid,
        groupName: dto.groupName?.trim() || group.subject,
        secretHash: generated.hash,
        secretHint: generated.hint,
        active: dto.active ?? true,
      },
      include: INTEGRATION_INCLUDE,
    });

    return { ...toView(integration), secret: generated.secret };
  }

  async update(id: string, dto: UpdateWebhookIntegrationDto): Promise<WebhookIntegrationView> {
    const { tenantId } = this.tenantContext.requireContext();
    const current = await this.requireIntegration(id);

    const nextInstanceId = dto.whatsappInstanceId ?? current.whatsappInstanceId;
    const nextGroupJid = dto.groupJid ?? current.groupJid;
    const destinationChanged =
      nextInstanceId !== current.whatsappInstanceId || nextGroupJid !== current.groupJid;

    let groupName =
      dto.groupName !== undefined ? dto.groupName.trim() || null : current.groupName;
    if (destinationChanged) {
      const instance = await this.requireSendableInstance(tenantId, nextInstanceId);
      const group = await this.resolveGroup(instance.instanceName, nextGroupJid);
      groupName = dto.groupName?.trim() || group.subject || current.groupName;
    }

    const integration = await this.prisma.webhookIntegration.update({
      where: { id: current.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(destinationChanged
          ? {
              whatsappInstanceId: nextInstanceId,
              groupJid: nextGroupJid,
            }
          : {}),
        ...(groupName !== current.groupName ? { groupName } : {}),
      },
      include: INTEGRATION_INCLUDE,
    });

    return toView(integration);
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.webhookIntegration.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), active: false },
    });

    if (result.count === 0) {
      throw new WebhookIntegrationNotFoundError();
    }
  }

  async regenerateSecret(id: string): Promise<WebhookIntegrationWithSecret> {
    const current = await this.requireIntegration(id);
    const generated = generateWebhookSecret();

    const integration = await this.prisma.webhookIntegration.update({
      where: { id: current.id },
      data: { secretHash: generated.hash, secretHint: generated.hint },
      include: INTEGRATION_INCLUDE,
    });

    return { ...toView(integration), secret: generated.secret };
  }

  async listGroups(whatsappInstanceId: string): Promise<WebhookGroupView[]> {
    const { tenantId } = this.tenantContext.requireContext();
    const instance = await this.requireSendableInstance(tenantId, whatsappInstanceId);
    const groups = await this.evolution.findGroups(instance.instanceName);

    return groups
      .map((group) => ({
        jid: group.groupJid,
        name: group.subject,
        size: group.size,
      }))
      .sort((left, right) => (left.name ?? left.jid).localeCompare(right.name ?? right.jid));
  }

  private async requireIntegration(id: string): Promise<PrismaIntegration> {
    const { tenantId } = this.tenantContext.requireContext();
    const integration = await this.prisma.webhookIntegration.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: INTEGRATION_INCLUDE,
    });

    if (!integration) {
      throw new WebhookIntegrationNotFoundError();
    }

    return integration;
  }

  private async requireSendableInstance(tenantId: string, id: string) {
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { id, tenantId },
      select: INSTANCE_SELECT,
    });

    if (!instance || !instance.active) {
      throw new WebhookInstanceUnavailableError();
    }
    if (instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WebhookInstanceUnavailableError(
        'A instância do WhatsApp precisa estar conectada para selecionar grupos.',
      );
    }

    return instance;
  }

  private async resolveGroup(instanceName: string, groupJid: string) {
    const normalized = groupJid.trim();
    if (!isGroupJid(normalized) || !WEBHOOK_GROUP_JID_PATTERN.test(normalized)) {
      throw new WebhookGroupInvalidError();
    }

    const group = await this.evolution.findGroupInfos(instanceName, normalized);
    if (!group) {
      throw new WebhookGroupNotFoundError();
    }

    return group;
  }
}

function toView(integration: PrismaIntegration): WebhookIntegrationView {
  return {
    id: integration.id,
    name: integration.name,
    whatsappInstanceId: integration.whatsappInstanceId,
    instanceName: integration.instance.name,
    instanceStatus: integration.instance.status,
    groupJid: integration.groupJid,
    groupName: integration.groupName,
    active: integration.active,
    secretHint: integration.secretHint,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}
