import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookExecutionStatus, WhatsAppInstanceStatus } from '@prisma/client';
import { AppException } from '../../../common/errors/app.exception.js';
import { buildPage, skipOf, type PageResult } from '../../../common/http/pagination.js';
import { RateLimitedError } from '../../../common/http/rate-limit/rate-limit.guard.js';
import { RateLimitService } from '../../../common/http/rate-limit/rate-limit.service.js';
import { TenantContextService } from '../../../common/tenant-context/tenant-context.service.js';
import { isGroupJid } from '../../../common/whatsapp/jid.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { ConversationProcessingService } from '../../conversations/conversation-processing.service.js';
import { MODULE_KEYS } from '../../modules/modules.constants.js';
import { ModuleDisabledError } from '../../modules/modules.errors.js';
import { ModulesService } from '../../modules/modules.service.js';
import {
  EvolutionClient,
  EvolutionRequestError,
  EvolutionUnavailableError,
} from '../../whatsapp/evolution/evolution.client.js';
import type { ListWebhookExecutionsQueryDto } from './dto/webhook.dto.js';
import { WEBHOOK_MAX_CAPTION_LENGTH } from './dto/webhook.dto.js';
import { WebhookImageService } from './webhook-image.service.js';
import {
  WebhookExecutionFailedError,
  WebhookExecutionInProgressError,
  WebhookGroupInvalidError,
  WebhookIdempotencyKeyInvalidError,
  WebhookInstanceUnavailableError,
  WebhookIntegrationInactiveError,
  WebhookIntegrationNotFoundError,
  WebhookProviderError,
  WebhookProviderUnavailableError,
  WebhookRecordingFailedError,
  WebhookUnauthorizedError,
} from './webhooks.errors.js';
import { webhookSecretMatches } from './webhook-secret.js';

const EXECUTIONS_PER_WEBHOOK_PER_MINUTE = 60;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_ERROR_MESSAGE_LENGTH = 300;
const WEBHOOK_IMAGE_SHORT_CAPTION = 'Atualização da contribuição';

export interface ExecuteWebhookInput {
  webhookId: string;
  secret: string | null;
  message: string;
  imageUrl?: string | null;
  idempotencyKey?: string | null;
  ip: string;
}

export interface WebhookExecutionResult {
  ok: true;
  executionId: string;
  status: WebhookExecutionStatus;
  externalMessageId: string | null;
  messageId: string | null;
  conversationId: string | null;
}

export interface WebhookExecutionView {
  id: string;
  status: WebhookExecutionStatus;
  externalMessageId: string | null;
  messageId: string | null;
  conversationId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

@Injectable()
export class WebhookExecutionService {
  private readonly logger = new Logger(WebhookExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly modules: ModulesService,
    private readonly limiter: RateLimitService,
    private readonly evolution: EvolutionClient,
    private readonly conversations: ConversationProcessingService,
    private readonly images: WebhookImageService,
  ) {}

  async execute(input: ExecuteWebhookInput): Promise<WebhookExecutionResult> {
    const integration = await this.prisma.webhookIntegration.findFirst({
      where: { id: input.webhookId, deletedAt: null },
      include: {
        instance: {
          select: {
            id: true,
            instanceName: true,
            status: true,
            active: true,
          },
        },
      },
    });

    if (!integration) {
      throw new WebhookIntegrationNotFoundError();
    }
    if (!input.secret || !webhookSecretMatches(input.secret, integration.secretHash)) {
      throw new WebhookUnauthorizedError();
    }

    const moduleEnabled = await this.modules.isEnabled(integration.tenantId, MODULE_KEYS.WEBHOOKS);
    if (!moduleEnabled) {
      throw new ModuleDisabledError(MODULE_KEYS.WEBHOOKS);
    }

    if (!integration.active) {
      throw new WebhookIntegrationInactiveError();
    }
    if (!integration.instance.active) {
      throw new WebhookInstanceUnavailableError();
    }
    if (integration.instance.status !== WhatsAppInstanceStatus.CONNECTED) {
      throw new WebhookInstanceUnavailableError(
        'A instância do WhatsApp está desconectada. Reconecte o número para enviar mensagens.',
      );
    }
    if (!isGroupJid(integration.groupJid)) {
      throw new WebhookGroupInvalidError('A integração não possui um grupo de WhatsApp válido.');
    }

    const rateKey = `webhook-integration:${integration.id}:${input.ip || 'unknown'}`;
    if (
      !this.limiter.hit(
        rateKey,
        EXECUTIONS_PER_WEBHOOK_PER_MINUTE,
        60_000,
      )
    ) {
      throw new RateLimitedError();
    }

    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    if (idempotencyKey) {
      const replay = await this.findIdempotentExecution(integration.id, idempotencyKey);
      if (replay) {
        return this.replay(replay);
      }
    }

    const executionId = await this.reserveExecution(
      integration.tenantId,
      integration.id,
      idempotencyKey,
    );

    if (input.imageUrl) {
      return this.executeImage({
        integration,
        executionId,
        message: input.message,
        imageUrl: input.imageUrl,
      });
    }

    let sent: Awaited<ReturnType<EvolutionClient['sendText']>>;
    try {
      sent = await this.evolution.sendText(
        integration.instance.instanceName,
        integration.groupJid,
        input.message,
      );
    } catch (error) {
      const sanitized = sanitizeSendError(error);
      await this.markFailed(executionId, sanitized.code, sanitized.message);
      if (error instanceof EvolutionUnavailableError) {
        throw new WebhookProviderUnavailableError(executionId);
      }
      throw new WebhookProviderError(
        executionId,
        error instanceof EvolutionRequestError ? error.httpStatus : undefined,
      );
    }

    let recorded: { messageId: string; conversationId: string } | null;
    try {
      recorded = await this.conversations.recordOutboundMessage({
        tenantId: integration.tenantId,
        whatsappInstanceId: integration.instance.id,
        externalContactId: integration.groupJid,
        contactId: null,
        text: input.message,
        externalMessageId: sent.externalMessageId ?? null,
        isGroup: true,
        groupName: integration.groupName,
        metadata: {
          source: 'webhook_integration',
          webhookIntegrationId: integration.id,
          ...(sent.externalMessageId
            ? { externalMessageId: sent.externalMessageId }
            : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record webhook integration message ${executionId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      await this.markFailed(executionId, 'WEBHOOK_RECORDING_FAILED', 'Falha ao registrar a mensagem.');
      throw new WebhookRecordingFailedError(executionId);
    }

    const updated = await this.markSucceeded(executionId, {
      externalMessageId: sent.externalMessageId ?? null,
      messageId: recorded?.messageId ?? null,
      conversationId: recorded?.conversationId ?? null,
    });

    return {
      ok: true,
      executionId: updated.id,
      status: updated.status,
      externalMessageId: updated.externalMessageId,
      messageId: updated.messageId,
      conversationId: updated.conversationId,
    };
  }

  private async executeImage(params: {
    integration: {
      id: string;
      tenantId: string;
      groupJid: string;
      groupName: string | null;
      instance: { id: string; instanceName: string };
    };
    executionId: string;
    message: string;
    imageUrl: string;
  }): Promise<WebhookExecutionResult> {
    let image: Awaited<ReturnType<WebhookImageService['fetch']>>;
    try {
      image = await this.images.fetch(params.imageUrl);
    } catch (error) {
      const sanitized = sanitizeImageError(error);
      await this.markFailed(params.executionId, sanitized.code, sanitized.message);
      throw error;
    }

    const caption =
      params.message.length <= WEBHOOK_MAX_CAPTION_LENGTH
        ? params.message
        : WEBHOOK_IMAGE_SHORT_CAPTION;

    let sent: Awaited<ReturnType<ConversationProcessingService['sendExternalImage']>>;
    try {
      sent = await this.conversations.sendExternalImage({
        tenantId: params.integration.tenantId,
        whatsappInstanceId: params.integration.instance.id,
        externalContactId: params.integration.groupJid,
        contactId: null,
        caption,
        buffer: image.buffer,
        fileName: image.fileName,
        isGroup: true,
        groupName: params.integration.groupName,
        metadata: {
          source: 'webhook_integration',
          webhookIntegrationId: params.integration.id,
          imageSourceUrl: params.imageUrl,
          imageCaptionMode: caption === params.message ? 'full' : 'short',
        },
      });
    } catch (error) {
      return this.failExecution(params.executionId, error);
    }

    if (params.message.length > WEBHOOK_MAX_CAPTION_LENGTH) {
      let textSent: Awaited<ReturnType<EvolutionClient['sendText']>>;
      try {
        textSent = await this.evolution.sendText(
          params.integration.instance.instanceName,
          params.integration.groupJid,
          params.message,
          undefined,
          { linkPreview: false },
        );
      } catch (error) {
        return this.failExecution(params.executionId, error);
      }

      let recorded: Awaited<ReturnType<ConversationProcessingService['recordOutboundMessage']>>;
      try {
        recorded = await this.conversations.recordOutboundMessage({
          tenantId: params.integration.tenantId,
          whatsappInstanceId: params.integration.instance.id,
          externalContactId: params.integration.groupJid,
          contactId: null,
          text: params.message,
          externalMessageId: textSent.externalMessageId ?? null,
          isGroup: true,
          groupName: params.integration.groupName,
          metadata: {
            source: 'webhook_integration',
            webhookIntegrationId: params.integration.id,
            imageSourceUrl: params.imageUrl,
            imageExternalMessageId: sent.externalMessageId,
          },
        });
      } catch (error) {
        return this.failExecution(params.executionId, error);
      }

      if (!recorded) {
        await this.markFailed(
          params.executionId,
          'WEBHOOK_RECORDING_FAILED',
          'Falha ao registrar a mensagem.',
        );
        throw new WebhookRecordingFailedError(params.executionId);
      }

      sent = {
        messageId: recorded.messageId,
        conversationId: recorded.conversationId,
        externalMessageId: textSent.externalMessageId ?? null,
      };
    }

    const updated = await this.markSucceeded(params.executionId, {
      externalMessageId: sent.externalMessageId,
      messageId: sent.messageId,
      conversationId: sent.conversationId,
    });

    return {
      ok: true,
      executionId: updated.id,
      status: updated.status,
      externalMessageId: updated.externalMessageId,
      messageId: updated.messageId,
      conversationId: updated.conversationId,
    };
  }

  private async failExecution(executionId: string, error: unknown): Promise<never> {
    if (error instanceof EvolutionUnavailableError) {
      await this.markFailed(executionId, 'EVOLUTION_UNAVAILABLE', 'Evolution API indisponível.');
      throw new WebhookProviderUnavailableError(executionId);
    }
    if (error instanceof EvolutionRequestError) {
      const sanitized = sanitizeSendError(error);
      await this.markFailed(executionId, sanitized.code, sanitized.message);
      throw new WebhookProviderError(executionId, error.httpStatus);
    }
    if (error instanceof AppException) {
      await this.markFailed(executionId, error.code, error.message);
      throw error;
    }
    this.logger.warn(
      `Failed to send webhook integration image ${executionId}: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    );
    await this.markFailed(executionId, 'WEBHOOK_SEND_FAILED', 'Falha ao enviar a imagem.');
    throw new WebhookProviderError(executionId);
  }

  async listExecutions(
    webhookId: string,
    query: ListWebhookExecutionsQueryDto,
  ): Promise<PageResult<WebhookExecutionView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const integration = await this.prisma.webhookIntegration.findFirst({
      where: { id: webhookId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!integration) {
      throw new WebhookIntegrationNotFoundError();
    }

    const where: Prisma.WebhookExecutionWhereInput = {
      tenantId,
      webhookId: integration.id,
    };
    if (query.search) {
      where.OR = [
        { externalMessageId: { contains: query.search, mode: 'insensitive' } },
        { errorCode: { contains: query.search, mode: 'insensitive' } },
        { errorMessage: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, executions] = await this.prisma.$transaction([
      this.prisma.webhookExecution.count({ where }),
      this.prisma.webhookExecution.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(executions.map(toExecutionView), total, query.page, query.perPage);
  }

  private async reserveExecution(
    tenantId: string,
    webhookId: string,
    idempotencyKey: string | null,
  ): Promise<string> {
    if (!idempotencyKey) {
      const execution = await this.prisma.webhookExecution.create({
        data: {
          tenantId,
          webhookId,
          status: WebhookExecutionStatus.PROCESSING,
        },
        select: { id: true },
      });
      return execution.id;
    }

    try {
      const execution = await this.prisma.webhookExecution.create({
        data: {
          tenantId,
          webhookId,
          idempotencyKey,
          status: WebhookExecutionStatus.PROCESSING,
        },
        select: { id: true },
      });
      return execution.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findIdempotentExecution(webhookId, idempotencyKey);
        if (existing) {
          throw new WebhookExecutionInProgressError(existing.id);
        }
      }
      throw error;
    }
  }

  private async findIdempotentExecution(
    webhookId: string,
    idempotencyKey: string,
  ): Promise<{
    id: string;
    status: WebhookExecutionStatus;
    externalMessageId: string | null;
    messageId: string | null;
    conversationId: string | null;
  } | null> {
    return this.prisma.webhookExecution.findUnique({
      where: { webhookId_idempotencyKey: { webhookId, idempotencyKey } },
      select: {
        id: true,
        status: true,
        externalMessageId: true,
        messageId: true,
        conversationId: true,
      },
    });
  }

  private replay(execution: {
    id: string;
    status: WebhookExecutionStatus;
    externalMessageId: string | null;
    messageId: string | null;
    conversationId: string | null;
  }): WebhookExecutionResult {
    if (execution.status === WebhookExecutionStatus.SUCCESS) {
      return {
        ok: true,
        executionId: execution.id,
        status: execution.status,
        externalMessageId: execution.externalMessageId,
        messageId: execution.messageId,
        conversationId: execution.conversationId,
      };
    }
    if (execution.status === WebhookExecutionStatus.PROCESSING) {
      throw new WebhookExecutionInProgressError(execution.id);
    }
    throw new WebhookExecutionFailedError(execution.id);
  }

  private async markSucceeded(
    executionId: string,
    data: {
      externalMessageId: string | null;
      messageId: string | null;
      conversationId: string | null;
    },
  ) {
    return this.prisma.webhookExecution.update({
      where: { id: executionId },
      data: {
        status: WebhookExecutionStatus.SUCCESS,
        externalMessageId: data.externalMessageId,
        messageId: data.messageId,
        conversationId: data.conversationId,
        errorCode: null,
        errorMessage: null,
      },
      select: {
        id: true,
        status: true,
        externalMessageId: true,
        messageId: true,
        conversationId: true,
      },
    });
  }

  private async markFailed(
    executionId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.prisma.webhookExecution.update({
        where: { id: executionId },
        data: {
          status: WebhookExecutionStatus.FAILED,
          errorCode,
          errorMessage: errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist webhook execution failure ${executionId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new WebhookIdempotencyKeyInvalidError();
  }
  return trimmed;
}

function sanitizeSendError(error: unknown): { code: string; message: string } {
  if (error instanceof EvolutionUnavailableError) {
    return { code: 'EVOLUTION_UNAVAILABLE', message: 'Evolution API indisponível.' };
  }
  if (error instanceof EvolutionRequestError) {
    return {
      code: error.httpStatus ? `EVOLUTION_HTTP_${error.httpStatus}` : 'EVOLUTION_NETWORK',
      message: error.httpStatus
        ? `A Evolution API respondeu com status ${error.httpStatus}.`
        : 'Não foi possível concluir a requisição à Evolution API.',
    };
  }
  if (error instanceof AppException) {
    return { code: error.code, message: error.message };
  }
  return { code: 'WEBHOOK_SEND_FAILED', message: 'Falha ao enviar a mensagem pelo WhatsApp.' };
}

function sanitizeImageError(error: unknown): { code: string; message: string } {
  if (error instanceof AppException) {
    return { code: error.code, message: error.message };
  }
  return { code: 'WEBHOOK_IMAGE_FETCH_FAILED', message: 'Não foi possível obter a imagem.' };
}

function toExecutionView(execution: {
  id: string;
  status: WebhookExecutionStatus;
  externalMessageId: string | null;
  messageId: string | null;
  conversationId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}): WebhookExecutionView {
  return {
    id: execution.id,
    status: execution.status,
    externalMessageId: execution.externalMessageId,
    messageId: execution.messageId,
    conversationId: execution.conversationId,
    errorCode: execution.errorCode,
    errorMessage: execution.errorMessage,
    createdAt: execution.createdAt,
  };
}
