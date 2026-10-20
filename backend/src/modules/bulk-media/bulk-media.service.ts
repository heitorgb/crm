import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BulkMediaBatchStatus,
  BulkMediaRecipientStatus,
  Prisma,
} from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { pickDestination } from '../../common/whatsapp/destination.js';
import type { Env } from '../../config/env.validation.js';
import { MediaProcessingService } from '../../infrastructure/media/media-processing.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import { ConversationProcessingService } from '../conversations/conversation-processing.service.js';
import {
  BULK_MEDIA_MAX_ERROR_LENGTH,
  BULK_MEDIA_STALE_PROCESSING_MS,
} from './bulk-media.constants.js';
import {
  BulkMediaBatchNotFoundError,
  BulkMediaIdempotencyKeyRequiredError,
  BulkMediaInvalidImageError,
  BulkMediaInvalidRecipientsError,
  BulkMediaTooManyRecipientsError,
} from './bulk-media.errors.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';

const BATCH_INCLUDE = {
  recipients: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.BulkMediaBatchInclude;

type PrismaBatch = Prisma.BulkMediaBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

export interface BulkMediaRecipientView {
  id: string;
  conversationId: string;
  name: string;
  status: BulkMediaRecipientStatus;
  errorCode: string | null;
  errorMessage: string | null;
  messageId: string | null;
  externalMessageId: string | null;
  processedAt: Date | null;
}

export interface BulkMediaBatchView {
  id: string;
  caption: string | null;
  fileName: string;
  mimeType: string;
  status: BulkMediaBatchStatus;
  totalCount: number;
  successCount: number;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
  recipients: BulkMediaRecipientView[];
}

export interface CreateBulkMediaInput {
  tenantId: string;
  createdByUserId: string;
  idempotencyKey: string;
  caption: string | null;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  conversationIds: string[];
}

@Injectable()
export class BulkMediaService {
  private readonly logger = new Logger(BulkMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
    private readonly media: MediaProcessingService,
    private readonly conversations: ConversationProcessingService,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async create(input: CreateBulkMediaInput): Promise<BulkMediaBatchView> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (idempotencyKey.length === 0) {
      throw new BulkMediaIdempotencyKeyRequiredError();
    }

    const existing = await this.prisma.bulkMediaBatch.findFirst({
      where: { tenantId: input.tenantId, idempotencyKey },
      include: BATCH_INCLUDE,
    });
    if (existing) {
      return toBatchView(existing);
    }

    const conversationIds = [...new Set(input.conversationIds)];
    if (conversationIds.length === 0) {
      throw new BulkMediaInvalidRecipientsError();
    }
    const maxRecipients = this.config.get('BULK_MEDIA_MAX_RECIPIENTS');
    if (conversationIds.length > maxRecipients) {
      throw new BulkMediaTooManyRecipientsError(maxRecipients);
    }

    if (input.buffer.length === 0) {
      throw new BulkMediaInvalidImageError();
    }
    const maxBytes = this.config.get('MEDIA_MAX_BYTES');
    if (input.buffer.length > maxBytes) {
      throw new AppException('MEDIA_TOO_LARGE', 'Arquivo maior que o permitido.', 413);
    }
    if (!(await this.media.isImage(input.buffer))) {
      throw new BulkMediaInvalidImageError();
    }

    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId: input.tenantId,
        id: { in: conversationIds },
        deletedAt: null,
      },
      select: {
        id: true,
        contactId: true,
        externalContactId: true,
        externalLid: true,
        isGroup: true,
        groupName: true,
        whatsappInstanceId: true,
        contact: { select: { name: true, phone: true } },
        instance: { select: { status: true } },
      },
    });
    if (conversations.length !== conversationIds.length) {
      throw new BulkMediaInvalidRecipientsError(
        'Uma ou mais conversas selecionadas não pertencem a esta organização.',
      );
    }

    const recipients = conversations.map((conversation) => {
      const destination = pickDestination(
        {
          externalContactId: conversation.externalContactId,
          externalLid: conversation.externalLid,
          contactPhone: conversation.contact?.phone ?? null,
        },
        null,
      );
      if (!destination) {
        throw new BulkMediaInvalidRecipientsError(
          'Uma das conversas não possui um número de WhatsApp válido.',
        );
      }
      return {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        name:
          (conversation.isGroup ? conversation.groupName : conversation.contact?.name) ??
          conversation.contact?.phone ??
          'Contato',
        destination: destination.address,
        whatsappInstanceId: conversation.whatsappInstanceId,
        status: BulkMediaRecipientStatus.PENDING,
      };
    });

    const batchId = randomUUID();
    const optimized = await this.media.optimizeImage(input.buffer);
    const thumbnail = await this.media.makeThumbnail(input.buffer);
    const baseKey = `tenant/${input.tenantId}/bulk-media/${batchId}/${randomUUID()}`;
    const storageKey = `${baseKey}.${optimized.extension}`;
    const thumbnailKey = `${baseKey}_thumb.${thumbnail.extension}`;

    await this.storage.put(storageKey, optimized.buffer);
    await this.storage.put(thumbnailKey, thumbnail.buffer);

    let batch: PrismaBatch;
    try {
      batch = await this.prisma.bulkMediaBatch.create({
        data: {
          id: batchId,
          tenantId: input.tenantId,
          createdByUserId: input.createdByUserId,
          idempotencyKey,
          caption: input.caption?.trim() || null,
          storageKey,
          thumbnailKey,
          fileName: ensureImageExtension(input.fileName, optimized.extension),
          mimeType: optimized.mimeType,
          size: optimized.size,
          status: BulkMediaBatchStatus.PENDING,
          totalCount: recipients.length,
          recipients: { create: recipients },
        },
        include: BATCH_INCLUDE,
      });
    } catch (error) {
      await Promise.allSettled([
        this.storage.delete(storageKey),
        this.storage.delete(thumbnailKey),
      ]);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.bulkMediaBatch.findFirst({
          where: { tenantId: input.tenantId, idempotencyKey },
          include: BATCH_INCLUDE,
        });
        if (raced) {
          return toBatchView(raced);
        }
      }
      throw error;
    }

    await this.enqueue(batch.id, input.tenantId);
    return toBatchView(batch);
  }

  async findOne(id: string): Promise<BulkMediaBatchView> {
    const { tenantId } = this.tenantContext.requireContext();
    return toBatchView(await this.requireBatch(tenantId, id));
  }

  async retry(id: string): Promise<BulkMediaBatchView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireBatch(tenantId, id);

    await this.prisma.$transaction([
      this.prisma.bulkMediaRecipient.updateMany({
        where: { tenantId, batchId: id, status: BulkMediaRecipientStatus.FAILED },
        data: {
          status: BulkMediaRecipientStatus.PENDING,
          attempts: 0,
          errorCode: null,
          errorMessage: null,
          processedAt: null,
        },
      }),
      this.prisma.bulkMediaBatch.update({
        where: { id },
        data: { status: BulkMediaBatchStatus.PENDING },
      }),
    ]);

    await this.enqueue(id, tenantId);
    return this.findOne(id);
  }

  async processBatch(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const batchId = asString(payload.batchId);
    if (!tenantId || !batchId) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const batch = await this.prisma.bulkMediaBatch.findFirst({
        where: { id: batchId, tenantId },
        include: BATCH_INCLUDE,
      });
      if (!batch) {
        return;
      }
      if (
        batch.status === BulkMediaBatchStatus.COMPLETED ||
        batch.status === BulkMediaBatchStatus.PARTIAL ||
        batch.status === BulkMediaBatchStatus.FAILED
      ) {
        return;
      }

      await this.prisma.bulkMediaBatch.update({
        where: { id: batch.id },
        data: { status: BulkMediaBatchStatus.PROCESSING },
      });

      const intervalMs = this.config.get('BULK_MEDIA_INTERVAL_MS');
      const pending = batch.recipients.filter(
        (recipient) => recipient.status === BulkMediaRecipientStatus.PENDING,
      );

      for (let index = 0; index < pending.length; index += 1) {
        const recipient = pending[index];
        const claim = await this.prisma.bulkMediaRecipient.updateMany({
          where: { id: recipient.id, status: BulkMediaRecipientStatus.PENDING },
          data: { status: BulkMediaRecipientStatus.PROCESSING, attempts: { increment: 1 } },
        });
        if (claim.count === 0) {
          continue;
        }

        try {
          const result = await this.conversations.sendStoredMediaToConversation({
            tenantId,
            conversationId: recipient.conversationId,
            storageKey: batch.storageKey,
            thumbnailKey: batch.thumbnailKey,
            fileName: batch.fileName,
            mimeType: batch.mimeType,
            size: batch.size,
            caption: batch.caption,
            metadata: {
              source: 'bulk_media',
              batchId: batch.id,
              batchRecipientId: recipient.id,
            },
          });

          await this.prisma.bulkMediaRecipient.update({
            where: { id: recipient.id },
            data: {
              status:
                result.status === 'SENT'
                  ? BulkMediaRecipientStatus.SENT
                  : BulkMediaRecipientStatus.FAILED,
              messageId: result.messageId,
              externalMessageId: result.externalMessageId,
              errorCode: result.errorCode ?? null,
              errorMessage: result.errorCode ? 'Falha ao enviar a foto.' : null,
              processedAt: new Date(),
            },
          });
        } catch (error) {
          const failure = describeFailure(error);
          await this.prisma.bulkMediaRecipient.update({
            where: { id: recipient.id },
            data: {
              status: BulkMediaRecipientStatus.FAILED,
              errorCode: failure.code,
              errorMessage: failure.message.slice(0, BULK_MEDIA_MAX_ERROR_LENGTH),
              processedAt: new Date(),
            },
          });
        }

        if (index < pending.length - 1 && intervalMs > 0) {
          await sleep(intervalMs);
        }
      }

      const [successCount, failureCount] = await Promise.all([
        this.prisma.bulkMediaRecipient.count({
          where: { batchId, status: BulkMediaRecipientStatus.SENT },
        }),
        this.prisma.bulkMediaRecipient.count({
          where: { batchId, status: BulkMediaRecipientStatus.FAILED },
        }),
      ]);

      const status =
        failureCount === 0
          ? BulkMediaBatchStatus.COMPLETED
          : successCount > 0
            ? BulkMediaBatchStatus.PARTIAL
            : BulkMediaBatchStatus.FAILED;

      await this.prisma.bulkMediaBatch.update({
        where: { id: batchId },
        data: { status, successCount, failureCount },
      });
    });
  }

  async scan(): Promise<void> {
    const staleBefore = new Date(Date.now() - BULK_MEDIA_STALE_PROCESSING_MS);
    const batches = await this.prisma.bulkMediaBatch.findMany({
      where: {
        OR: [
          { status: BulkMediaBatchStatus.PENDING },
          { status: BulkMediaBatchStatus.PROCESSING, updatedAt: { lt: staleBefore } },
        ],
      },
      select: { id: true, tenantId: true },
      take: 50,
    });

    for (const batch of batches) {
      await this.enqueue(batch.id, batch.tenantId);
    }
  }

  private async enqueue(batchId: string, tenantId: string): Promise<void> {
    try {
      await this.queue.enqueue(JOB_NAMES.BULK_MEDIA_SEND, { tenantId, batchId });
    } catch (error) {
      this.logger.warn(
        `Could not enqueue bulk media ${batchId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async requireBatch(tenantId: string, id: string): Promise<PrismaBatch> {
    const batch = await this.prisma.bulkMediaBatch.findFirst({
      where: { id, tenantId },
      include: BATCH_INCLUDE,
    });
    if (!batch) {
      throw new BulkMediaBatchNotFoundError();
    }
    return batch;
  }

  private runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const context: TenantContext = {
      tenantId,
      userId: SYSTEM_USER_ID,
      membershipId: SYSTEM_MEMBERSHIP_ID,
      role: 'SYSTEM',
    };
    return this.tenantContext.run({ tenant: context }, fn);
  }
}

function toBatchView(batch: PrismaBatch): BulkMediaBatchView {
  return {
    id: batch.id,
    caption: batch.caption,
    fileName: batch.fileName,
    mimeType: batch.mimeType,
    status: batch.status,
    totalCount: batch.totalCount,
    successCount: batch.successCount,
    failureCount: batch.failureCount,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    recipients: batch.recipients.map((recipient) => ({
      id: recipient.id,
      conversationId: recipient.conversationId,
      name: recipient.name,
      status: recipient.status,
      errorCode: recipient.errorCode,
      errorMessage: recipient.errorMessage,
      messageId: recipient.messageId,
      externalMessageId: recipient.externalMessageId,
      processedAt: recipient.processedAt,
    })),
  };
}

function describeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AppException) {
    return { code: error.code, message: error.message };
  }
  return { code: 'BULK_MEDIA_SEND_FAILED', message: 'Falha ao enviar a foto.' };
}

function ensureImageExtension(fileName: string, extension: string): string {
  const base = fileName.replace(/[^\w.\- ]/g, '_').trim() || 'foto';
  return base.includes('.') ? base : `${base}.${extension}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
