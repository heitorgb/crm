import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduledMessageRecipientStatus, ScheduledMessageStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { ConversationProcessingService } from '../conversations/conversation-processing.service.js';
import {
  SCHEDULED_MESSAGE_MAX_ERROR_LENGTH,
  SCHEDULED_MESSAGE_RETRY_BASE_MS,
  SCHEDULED_MESSAGE_RETRY_MAX_MS,
  SCHEDULED_MESSAGE_STALE_PROCESSING_MS,
} from './scheduled-messages.constants.js';
import { renderScheduledMessage } from './scheduled-message-render.js';
import { addRecurrence, type ScheduledRecurrence } from './scheduled-message-time.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';

@Injectable()
export class ScheduledMessageSenderService {
  private readonly logger = new Logger(ScheduledMessageSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
    private readonly conversations: ConversationProcessingService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async processOccurrence(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const scheduleId = asString(payload.scheduleId);
    const scheduledForValue = asString(payload.scheduledFor);
    if (!tenantId || !scheduleId || !scheduledForValue) {
      return;
    }
    const scheduledFor = new Date(scheduledForValue);
    if (Number.isNaN(scheduledFor.getTime())) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const schedule = await this.prisma.scheduledMessage.findFirst({
        where: { id: scheduleId, tenantId },
      });
      if (!schedule || schedule.status === ScheduledMessageStatus.CANCELED) {
        return;
      }

      const recipients = await this.prisma.scheduledMessageRecipient.findMany({
        where: { tenantId, scheduledMessageId: scheduleId, scheduledFor },
        orderBy: { createdAt: 'asc' },
      });
      if (recipients.length === 0) {
        return;
      }

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const companyName = tenant?.name?.trim() ?? '';
      const maxAttempts = this.config.get('SCHEDULED_MESSAGE_MAX_ATTEMPTS');
      const intervalMs = this.config.get('SCHEDULED_MESSAGE_INTERVAL_MS');
      let processed = 0;

      for (const recipient of recipients) {
        const now = new Date();
        const retryableFailed =
          recipient.status === ScheduledMessageRecipientStatus.FAILED &&
          recipient.attempts < maxAttempts &&
          (!recipient.nextAttemptAt || recipient.nextAttemptAt.getTime() <= now.getTime());
        if (recipient.status !== ScheduledMessageRecipientStatus.PENDING && !retryableFailed) {
          continue;
        }

        const claim = await this.prisma.scheduledMessageRecipient.updateMany({
          where: {
            id: recipient.id,
            status: {
              in: [ScheduledMessageRecipientStatus.PENDING, ScheduledMessageRecipientStatus.FAILED],
            },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          data: {
            status: ScheduledMessageRecipientStatus.PROCESSING,
            attempts: { increment: 1 },
            errorCode: null,
            errorMessage: null,
          },
        });
        if (claim.count === 0) {
          continue;
        }

        const text = renderScheduledMessage(schedule.content, {
          nome: recipient.recipientName,
          empresa: companyName,
          valor: schedule.valor ?? '',
        });

        try {
          if (!recipient.conversationId) {
            throw new AppException(
              'SCHEDULED_MESSAGE_RECIPIENT_INVALID',
              'Destinatário sem conversa vinculada.',
              422,
            );
          }

          const result =
            schedule.attachmentStorageKey &&
            schedule.attachmentMimeType &&
            schedule.attachmentFileName
              ? await this.conversations.sendStoredMediaToConversation({
                  tenantId,
                  conversationId: recipient.conversationId,
                  storageKey: schedule.attachmentStorageKey,
                  thumbnailKey: schedule.attachmentThumbnailKey,
                  fileName: schedule.attachmentFileName,
                  mimeType: schedule.attachmentMimeType,
                  size: schedule.attachmentSize ?? 0,
                  caption: text,
                  metadata: {
                    source: 'scheduled_message',
                    scheduledMessageId: schedule.id,
                    scheduledFor: scheduledFor.toISOString(),
                  },
                })
              : await this.conversations.sendStoredTextToConversation({
                  tenantId,
                  conversationId: recipient.conversationId,
                  text,
                  metadata: {
                    source: 'scheduled_message',
                    scheduledMessageId: schedule.id,
                    scheduledFor: scheduledFor.toISOString(),
                  },
                });

          if (result.status === 'SENT') {
            await this.prisma.scheduledMessageRecipient.update({
              where: { id: recipient.id },
              data: {
                status: ScheduledMessageRecipientStatus.SENT,
                messageId: result.messageId,
                externalMessageId: result.externalMessageId,
                errorCode: null,
                errorMessage: null,
                nextAttemptAt: null,
                processedAt: new Date(),
              },
            });
          } else {
            await this.registerFailure(
              recipient.id,
              recipient.attempts + 1,
              maxAttempts,
              result.errorCode ?? 'SCHEDULED_MESSAGE_SEND_FAILED',
              'Falha ao enviar a mensagem.',
            );
          }
        } catch (error) {
          const failure = describeFailure(error);
          await this.registerFailure(
            recipient.id,
            recipient.attempts + 1,
            maxAttempts,
            failure.code,
            failure.message,
          );
        }

        processed += 1;
        if (processed < recipients.length && intervalMs > 0) {
          await sleep(intervalMs);
        }
      }

      await this.finishOccurrence(tenantId, schedule, scheduledFor, maxAttempts);
    });
  }

  async scan(): Promise<void> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - SCHEDULED_MESSAGE_STALE_PROCESSING_MS);

    await this.prisma.scheduledMessageRecipient.updateMany({
      where: {
        status: ScheduledMessageRecipientStatus.PROCESSING,
        updatedAt: { lt: staleBefore },
      },
      data: { status: ScheduledMessageRecipientStatus.PENDING, nextAttemptAt: now },
    });
    await this.prisma.scheduledMessage.updateMany({
      where: { status: ScheduledMessageStatus.PROCESSING, updatedAt: { lt: staleBefore } },
      data: { status: ScheduledMessageStatus.SCHEDULED },
    });

    const due = await this.prisma.scheduledMessage.findMany({
      where: {
        status: ScheduledMessageStatus.SCHEDULED,
        nextRunAt: { lte: now },
      },
      select: { id: true, tenantId: true, nextRunAt: true },
      take: 50,
    });
    for (const schedule of due) {
      if (!schedule.nextRunAt) {
        continue;
      }
      const claim = await this.prisma.scheduledMessage.updateMany({
        where: {
          id: schedule.id,
          status: ScheduledMessageStatus.SCHEDULED,
          nextRunAt: schedule.nextRunAt,
        },
        data: { status: ScheduledMessageStatus.PROCESSING },
      });
      if (claim.count === 0) {
        continue;
      }
      await this.enqueue(schedule.tenantId, schedule.id, schedule.nextRunAt);
    }

    const retryable = await this.prisma.scheduledMessageRecipient.findMany({
      where: {
        status: ScheduledMessageRecipientStatus.FAILED,
        attempts: { lt: this.config.get('SCHEDULED_MESSAGE_MAX_ATTEMPTS') },
        nextAttemptAt: { lte: now },
      },
      select: { tenantId: true, scheduledMessageId: true, scheduledFor: true },
      take: 100,
    });
    const seen = new Set<string>();
    for (const recipient of retryable) {
      const key = `${recipient.scheduledMessageId}:${recipient.scheduledFor.toISOString()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      await this.enqueue(recipient.tenantId, recipient.scheduledMessageId, recipient.scheduledFor);
    }
  }

  private async finishOccurrence(
    tenantId: string,
    schedule: {
      id: string;
      recurrence: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
      timeZone: string;
      status: ScheduledMessageStatus;
      nextRunAt: Date | null;
    },
    scheduledFor: Date,
    maxAttempts: number,
  ): Promise<void> {
    const failed = await this.prisma.scheduledMessageRecipient.count({
      where: {
        tenantId,
        scheduledMessageId: schedule.id,
        scheduledFor,
        status: ScheduledMessageRecipientStatus.FAILED,
      },
    });
    const pending = await this.prisma.scheduledMessageRecipient.count({
      where: {
        tenantId,
        scheduledMessageId: schedule.id,
        scheduledFor,
        status: {
          in: [ScheduledMessageRecipientStatus.PENDING, ScheduledMessageRecipientStatus.PROCESSING],
        },
      },
    });

    const isCurrent = schedule.nextRunAt?.getTime() === scheduledFor.getTime();
    const hasRetryableFailures = await this.prisma.scheduledMessageRecipient.count({
      where: {
        tenantId,
        scheduledMessageId: schedule.id,
        scheduledFor,
        status: ScheduledMessageRecipientStatus.FAILED,
        attempts: { lt: maxAttempts },
      },
    });

    if (schedule.recurrence === 'ONCE') {
      await this.prisma.scheduledMessage.update({
        where: { id: schedule.id },
        data: {
          status:
            failed === 0 && pending === 0
              ? ScheduledMessageStatus.SENT
              : ScheduledMessageStatus.FAILED,
          nextRunAt: null,
          lastRunAt: new Date(),
        },
      });
      return;
    }

    if (!isCurrent) {
      return;
    }

    const nextRunAt = addRecurrence(
      scheduledFor,
      schedule.recurrence as ScheduledRecurrence,
      schedule.timeZone,
    );
    await this.cloneRecipients(tenantId, schedule.id, scheduledFor, nextRunAt);
    await this.prisma.scheduledMessage.update({
      where: { id: schedule.id },
      data: {
        status: ScheduledMessageStatus.SCHEDULED,
        nextRunAt,
        lastRunAt: new Date(),
      },
    });

    if (hasRetryableFailures > 0) {
      this.logger.debug(
        `Schedule ${schedule.id} has ${hasRetryableFailures} recipient(s) awaiting retry`,
      );
    }
  }

  private async cloneRecipients(
    tenantId: string,
    scheduleId: string,
    currentOccurrence: Date,
    nextOccurrence: Date,
  ): Promise<void> {
    const current = await this.prisma.scheduledMessageRecipient.findMany({
      where: { tenantId, scheduledMessageId: scheduleId, scheduledFor: currentOccurrence },
      select: {
        recipientKey: true,
        conversationId: true,
        contactId: true,
        recipientName: true,
        destination: true,
        whatsappInstanceId: true,
      },
    });
    if (current.length === 0) {
      return;
    }

    await this.prisma.scheduledMessageRecipient.createMany({
      data: current.map((recipient) => ({
        tenantId,
        scheduledMessageId: scheduleId,
        scheduledFor: nextOccurrence,
        recipientKey: recipient.recipientKey,
        conversationId: recipient.conversationId,
        contactId: recipient.contactId,
        recipientName: recipient.recipientName,
        destination: recipient.destination,
        whatsappInstanceId: recipient.whatsappInstanceId,
        status: ScheduledMessageRecipientStatus.PENDING,
      })),
      skipDuplicates: true,
    });
  }

  private async registerFailure(
    recipientId: string,
    attempts: number,
    maxAttempts: number,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const finalAttempt = attempts >= maxAttempts;
    await this.prisma.scheduledMessageRecipient.update({
      where: { id: recipientId },
      data: {
        status: ScheduledMessageRecipientStatus.FAILED,
        errorCode: errorCode.slice(0, SCHEDULED_MESSAGE_MAX_ERROR_LENGTH),
        errorMessage: errorMessage.slice(0, SCHEDULED_MESSAGE_MAX_ERROR_LENGTH),
        nextAttemptAt: finalAttempt ? null : new Date(Date.now() + backoffDelayMs(attempts)),
        processedAt: finalAttempt ? new Date() : null,
      },
    });
  }

  private async enqueue(tenantId: string, scheduleId: string, scheduledFor: Date): Promise<void> {
    try {
      await this.queue.enqueue(JOB_NAMES.SCHEDULED_MESSAGE_SEND, {
        tenantId,
        scheduleId,
        scheduledFor: scheduledFor.toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `Could not enqueue scheduled message ${scheduleId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
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

function backoffDelayMs(attempt: number): number {
  return Math.min(
    SCHEDULED_MESSAGE_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    SCHEDULED_MESSAGE_RETRY_MAX_MS,
  );
}

function describeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AppException) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'SCHEDULED_MESSAGE_SEND_FAILED',
    message: 'Falha ao enviar a mensagem.',
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
