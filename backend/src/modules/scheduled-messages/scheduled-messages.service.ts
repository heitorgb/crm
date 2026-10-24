import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ScheduledMessageRecurrence,
  ScheduledMessageRecipientStatus,
  ScheduledMessageStatus,
  ScheduledMessageType,
} from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { pickDestination } from '../../common/whatsapp/destination.js';
import type { Env } from '../../config/env.validation.js';
import { MediaProcessingService } from '../../infrastructure/media/media-processing.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import {
  ScheduledMessageAttachmentInvalidError,
  ScheduledMessageAttachmentTooLargeError,
  ScheduledMessageEmptyContentError,
  ScheduledMessageInvalidDateError,
  ScheduledMessageInvalidDayOfMonthError,
  ScheduledMessageInvalidRecipientsError,
  ScheduledMessageInvalidTimeError,
  ScheduledMessageInvalidTypeError,
  ScheduledMessageInvalidWeekdaysError,
  ScheduledMessageNotEditableError,
  ScheduledMessageNotFoundError,
  ScheduledMessageTooManyRecipientsError,
} from './scheduled-messages.errors.js';
import {
  addDaysLocal,
  isFutureLocalDateTime,
  localDayOfMonth,
  localIsoWeekday,
  localTimeOf,
  nextRecurringOccurrence,
  parseDayOfMonth,
  parseTimeOfDay,
  toLocalDateTimeString,
  zonedTimeToUtc,
} from './scheduled-message-time.js';
import {
  ALL_WEEKDAYS,
  parseWeekdays,
  resolveWeekdays,
  sameWeekdays,
  usesWeekdays,
} from './scheduled-message-weekdays.js';

export interface ScheduledMessageAttachmentFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface CreateScheduledMessageInput {
  tenantId: string;
  createdByUserId: string;
  type: string;
  title: string;
  content: string;
  valor: string | null;
  recurrence: string;
  weekdays?: unknown;
  dayOfMonth?: unknown;
  recurringTime?: string;
  scheduledAt?: string;
  conversationIds: string[];
  file: ScheduledMessageAttachmentFile | null;
}

export interface UpdateScheduledMessageInput {
  type?: string;
  title?: string;
  content?: string;
  valor?: string | null;
  recurrence?: string;
  weekdays?: unknown;
  dayOfMonth?: unknown;
  recurringTime?: string;
  scheduledAt?: string;
  conversationIds?: string[];
  file: ScheduledMessageAttachmentFile | null;
  removeAttachment?: boolean;
}

export interface ListScheduledMessagesParams {
  page: number;
  perPage: number;
  search?: string;
  status?: string;
  type?: string;
  order: 'asc' | 'desc';
}

export interface ScheduledMessageView {
  id: string;
  type: ScheduledMessageType;
  title: string;
  content: string;
  valor: string | null;
  recurrence: ScheduledMessageRecurrence;
  weekdays: number[];
  dayOfMonth: number | null;
  recurringTime: string | null;
  timeZone: string;
  scheduledAt: Date;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  recipientCount: number;
  status: ScheduledMessageStatus;
  canceledAt: Date | null;
  hasAttachment: boolean;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledMessageRecipientLog {
  id: string;
  recipientName: string;
  conversationId: string | null;
  destination: string;
  status: ScheduledMessageRecipientStatus;
  attempts: number;
  externalMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  processedAt: Date | null;
}

export interface ScheduledMessageRunLog {
  scheduledFor: Date;
  status: ScheduledMessageRecipientStatus;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  recipients: ScheduledMessageRecipientLog[];
}

interface RecipientDefinition {
  conversationId: string;
  contactId: string | null;
  recipientName: string;
  destination: string;
  whatsappInstanceId: string;
  recipientKey: string;
}

interface StoredAttachment {
  storageKey: string | null;
  thumbnailKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
}

interface ResolvedSchedule {
  weekdays: number[];
  dayOfMonth: number | null;
  recurringTime: string | null;
  scheduledAt: Date;
}

const EMPTY_ATTACHMENT: StoredAttachment = {
  storageKey: null,
  thumbnailKey: null,
  fileName: null,
  mimeType: null,
  size: null,
};

const SCHEDULE_SELECT = {
  id: true,
  type: true,
  title: true,
  content: true,
  valor: true,
  recurrence: true,
  weekdays: true,
  dayOfMonth: true,
  recurringTime: true,
  timeZone: true,
  scheduledAt: true,
  nextRunAt: true,
  lastRunAt: true,
  recipientCount: true,
  status: true,
  canceledAt: true,
  attachmentStorageKey: true,
  attachmentThumbnailKey: true,
  attachmentFileName: true,
  attachmentMimeType: true,
  attachmentSize: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ScheduledMessageSelect;

type PrismaSchedule = Prisma.ScheduledMessageGetPayload<{ select: typeof SCHEDULE_SELECT }>;

@Injectable()
export class ScheduledMessagesService {
  private readonly logger = new Logger(ScheduledMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
    private readonly media: MediaProcessingService,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async list(query: ListScheduledMessagesParams): Promise<PageResult<ScheduledMessageView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.ScheduledMessageWhereInput = { tenantId };

    if (query.status && query.status !== 'ALL') {
      where.status = query.status as ScheduledMessageStatus;
    }
    if (query.type && query.type !== 'ALL') {
      where.type = query.type as ScheduledMessageType;
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, schedules] = await this.prisma.$transaction([
      this.prisma.scheduledMessage.count({ where }),
      this.prisma.scheduledMessage.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        select: SCHEDULE_SELECT,
      }),
    ]);

    return buildPage(schedules.map(toView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<ScheduledMessageView> {
    const { tenantId } = this.tenantContext.requireContext();
    const schedule = await this.prisma.scheduledMessage.findFirst({
      where: { id, tenantId },
      select: SCHEDULE_SELECT,
    });
    if (!schedule) {
      throw new ScheduledMessageNotFoundError();
    }
    return toView(schedule);
  }

  async create(input: CreateScheduledMessageInput): Promise<ScheduledMessageView> {
    const type = parseType(input.type);
    const recurrence = parseRecurrence(input.recurrence);
    const title = input.title.trim();
    const content = input.content.trim();
    if (title.length === 0 || content.length === 0) {
      throw new ScheduledMessageEmptyContentError();
    }

    const timeZone = this.timeZone;
    const schedule = this.resolveCreateSchedule(recurrence, input, timeZone);
    const recipients = await this.resolveRecipients(input.tenantId, input.conversationIds);
    const scheduleId = randomUUID();
    const attachment = await this.storeAttachment(input.tenantId, scheduleId, input.file);

    try {
      const created = await this.prisma.scheduledMessage.create({
        data: {
          id: scheduleId,
          tenantId: input.tenantId,
          createdByUserId: input.createdByUserId,
          type,
          title,
          content,
          valor: normalizeOptional(input.valor),
          recurrence,
          weekdays: schedule.weekdays,
          dayOfMonth: schedule.dayOfMonth,
          recurringTime: schedule.recurringTime,
          timeZone,
          scheduledAt: schedule.scheduledAt,
          nextRunAt: schedule.scheduledAt,
          recipientCount: recipients.length,
          status: ScheduledMessageStatus.SCHEDULED,
          attachmentStorageKey: attachment.storageKey,
          attachmentThumbnailKey: attachment.thumbnailKey,
          attachmentFileName: attachment.fileName,
          attachmentMimeType: attachment.mimeType,
          attachmentSize: attachment.size,
          recipients: {
            create: recipients.map((recipient) => ({
              tenantId: input.tenantId,
              scheduledFor: schedule.scheduledAt,
              ...recipient,
              status: ScheduledMessageRecipientStatus.PENDING,
            })),
          },
        },
        select: SCHEDULE_SELECT,
      });
      return toView(created);
    } catch (error) {
      await this.deleteStoredAttachment(attachment);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.scheduledMessage.findFirst({
          where: { id: scheduleId, tenantId: input.tenantId },
          select: SCHEDULE_SELECT,
        });
        if (raced) {
          return toView(raced);
        }
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateScheduledMessageInput): Promise<ScheduledMessageView> {
    const { tenantId } = this.tenantContext.requireContext();
    const current = await this.prisma.scheduledMessage.findFirst({
      where: { id, tenantId },
      select: SCHEDULE_SELECT,
    });
    if (!current) {
      throw new ScheduledMessageNotFoundError();
    }
    if (current.status !== ScheduledMessageStatus.SCHEDULED) {
      throw new ScheduledMessageNotEditableError();
    }

    const type = input.type ? parseType(input.type) : current.type;
    const recurrence = input.recurrence ? parseRecurrence(input.recurrence) : current.recurrence;
    const title = input.title !== undefined ? input.title.trim() : current.title;
    const content = input.content !== undefined ? input.content.trim() : current.content;
    if (title.length === 0 || content.length === 0) {
      throw new ScheduledMessageEmptyContentError();
    }

    const timeZone = current.timeZone;
    const currentOccurrence = current.nextRunAt ?? current.scheduledAt;
    const weekdays = this.resolveUpdateWeekdays(
      recurrence,
      input.weekdays,
      current,
      currentOccurrence,
      timeZone,
    );
    const recurringTime =
      recurrence === 'ONCE'
        ? null
        : this.resolveRecurringTime(input.recurringTime, input.scheduledAt, current, timeZone);
    const dayOfMonth =
      recurrence === 'MONTHLY'
        ? this.resolveDayOfMonth(input.dayOfMonth, input.scheduledAt, current, timeZone)
        : null;

    let scheduledAt: Date;
    let nextRunAt: Date;
    if (recurrence === 'ONCE') {
      scheduledAt =
        input.scheduledAt !== undefined
          ? this.resolveScheduledAt(input.scheduledAt, timeZone)
          : current.scheduledAt;
      nextRunAt = input.scheduledAt !== undefined ? scheduledAt : currentOccurrence;
    } else {
      const currentConfig = this.currentRecurringConfig(current, currentOccurrence, timeZone);
      const timingChanged =
        current.recurrence !== recurrence ||
        currentConfig.recurringTime !== recurringTime ||
        (recurrence === 'MONTHLY'
          ? currentConfig.dayOfMonth !== dayOfMonth
          : !sameWeekdays(currentConfig.weekdays, weekdays));
      if (timingChanged) {
        if (!recurringTime) {
          throw new ScheduledMessageInvalidTimeError();
        }
        const next = nextRecurringOccurrence(
          recurrence,
          { weekdays, dayOfMonth, recurringTime },
          timeZone,
        );
        if (!next) {
          throw new ScheduledMessageInvalidDateError();
        }
        scheduledAt = next;
        nextRunAt = next;
      } else {
        scheduledAt = current.scheduledAt;
        nextRunAt = currentOccurrence;
      }
    }

    const recipients =
      input.conversationIds !== undefined
        ? await this.resolveRecipients(tenantId, input.conversationIds)
        : await this.existingRecipients(current.id, currentOccurrence);

    if (recipients.length === 0) {
      throw new ScheduledMessageInvalidRecipientsError();
    }

    const newAttachment = input.file ? await this.storeAttachment(tenantId, id, input.file) : null;
    const removeAttachment = input.removeAttachment === true;
    const attachment = newAttachment
      ? newAttachment
      : removeAttachment
        ? EMPTY_ATTACHMENT
        : {
            storageKey: current.attachmentStorageKey,
            thumbnailKey: current.attachmentThumbnailKey,
            fileName: current.attachmentFileName,
            mimeType: current.attachmentMimeType,
            size: current.attachmentSize,
          };

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.scheduledMessageRecipient.deleteMany({
          where: {
            tenantId,
            scheduledMessageId: id,
            scheduledFor: currentOccurrence,
            status: {
              in: [
                ScheduledMessageRecipientStatus.PENDING,
                ScheduledMessageRecipientStatus.PROCESSING,
              ],
            },
          },
        });

        if (recipients.length > 0) {
          await tx.scheduledMessageRecipient.createMany({
            data: recipients.map((recipient) => ({
              tenantId,
              scheduledMessageId: id,
              scheduledFor: nextRunAt,
              ...recipient,
              status: ScheduledMessageRecipientStatus.PENDING,
            })),
            skipDuplicates: true,
          });
        }

        await tx.scheduledMessage.update({
          where: { id },
          data: {
            type,
            title,
            content,
            valor: input.valor !== undefined ? normalizeOptional(input.valor) : current.valor,
            recurrence,
            weekdays,
            dayOfMonth,
            recurringTime,
            scheduledAt,
            nextRunAt,
            recipientCount: recipients.length,
            attachmentStorageKey: attachment.storageKey,
            attachmentThumbnailKey: attachment.thumbnailKey,
            attachmentFileName: attachment.fileName,
            attachmentMimeType: attachment.mimeType,
            attachmentSize: attachment.size,
          },
        });
      });
    } catch (error) {
      if (newAttachment) {
        await this.deleteStoredAttachment(newAttachment);
      }
      throw error;
    }

    if (newAttachment || removeAttachment) {
      await this.deleteStoredAttachment({
        storageKey: current.attachmentStorageKey,
        thumbnailKey: current.attachmentThumbnailKey,
        fileName: current.attachmentFileName,
        mimeType: current.attachmentMimeType,
        size: current.attachmentSize,
      });
    }

    return this.findOne(id);
  }

  async cancel(id: string): Promise<ScheduledMessageView> {
    const { tenantId } = this.tenantContext.requireContext();
    const current = await this.requireSchedule(tenantId, id);
    if (current.status === ScheduledMessageStatus.CANCELED) {
      return toView(current);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.scheduledMessage.updateMany({
        where: { id, tenantId, status: { not: ScheduledMessageStatus.CANCELED } },
        data: {
          status: ScheduledMessageStatus.CANCELED,
          canceledAt: new Date(),
          nextRunAt: null,
        },
      });
      await tx.scheduledMessageRecipient.updateMany({
        where: {
          tenantId,
          scheduledMessageId: id,
          status: {
            in: [
              ScheduledMessageRecipientStatus.PENDING,
              ScheduledMessageRecipientStatus.PROCESSING,
            ],
          },
        },
        data: { status: ScheduledMessageRecipientStatus.SKIPPED },
      });
    });

    return this.findOne(id);
  }

  async duplicate(id: string, scheduledAtInput?: string): Promise<ScheduledMessageView> {
    const { tenantId, userId } = this.tenantContext.requireContext();
    const original = await this.requireSchedule(tenantId, id);
    const timeZone = original.timeZone;
    const originalOccurrence = original.nextRunAt ?? original.scheduledAt;
    let scheduledAt: Date;
    let weekdays: number[];
    let dayOfMonth: number | null;
    let recurringTime: string | null;

    if (original.recurrence === 'ONCE') {
      let localDefault = addDaysLocal(toLocalDateTimeString(originalOccurrence, timeZone), 1);
      if (!isFutureLocalDateTime(localDefault, timeZone)) {
        localDefault = toLocalDateTimeString(new Date(Date.now() + 24 * 60 * 60 * 1000), timeZone);
      }
      scheduledAt = this.resolveScheduledAt(scheduledAtInput ?? localDefault, timeZone);
      weekdays = [];
      dayOfMonth = null;
      recurringTime = null;
    } else {
      recurringTime = this.resolveRecurringTime(
        scheduledAtInput,
        scheduledAtInput,
        original,
        timeZone,
      );
      weekdays = usesWeekdays(original.recurrence)
        ? original.weekdays.length > 0
          ? [...original.weekdays].sort((left, right) => left - right)
          : original.recurrence === 'DAILY'
            ? [...ALL_WEEKDAYS]
            : [localIsoWeekday(originalOccurrence, timeZone)]
        : [];
      dayOfMonth =
        original.recurrence === 'MONTHLY'
          ? (original.dayOfMonth ?? localDayOfMonth(original.scheduledAt, timeZone))
          : null;
      if (scheduledAtInput) {
        scheduledAt = this.resolveScheduledAt(scheduledAtInput, timeZone);
      } else {
        const next = nextRecurringOccurrence(
          original.recurrence,
          { weekdays, dayOfMonth, recurringTime },
          timeZone,
        );
        if (!next) {
          throw new ScheduledMessageInvalidDateError();
        }
        scheduledAt = next;
      }
    }

    const definitions = await this.existingRecipients(original.id, originalOccurrence);
    if (definitions.length === 0) {
      throw new ScheduledMessageInvalidRecipientsError();
    }

    const duplicateId = randomUUID();
    const attachment = await this.copyAttachment(tenantId, duplicateId, original);
    const created = await this.prisma.scheduledMessage.create({
      data: {
        id: duplicateId,
        tenantId,
        createdByUserId: userId,
        type: original.type,
        title: `${original.title} (cópia)`,
        content: original.content,
        valor: original.valor,
        recurrence: original.recurrence,
        weekdays,
        dayOfMonth,
        recurringTime,
        timeZone,
        scheduledAt,
        nextRunAt: scheduledAt,
        recipientCount: definitions.length,
        status: ScheduledMessageStatus.SCHEDULED,
        attachmentStorageKey: attachment.storageKey,
        attachmentThumbnailKey: attachment.thumbnailKey,
        attachmentFileName: attachment.fileName,
        attachmentMimeType: attachment.mimeType,
        attachmentSize: attachment.size,
        recipients: {
          create: definitions.map((recipient) => ({
            tenantId,
            scheduledFor: scheduledAt,
            ...recipient,
            status: ScheduledMessageRecipientStatus.PENDING,
          })),
        },
      },
      select: SCHEDULE_SELECT,
    });

    return toView(created);
  }

  async retry(id: string, scheduledForInput?: string): Promise<ScheduledMessageView> {
    const { tenantId } = this.tenantContext.requireContext();
    const schedule = await this.requireSchedule(tenantId, id);
    if (schedule.status === ScheduledMessageStatus.CANCELED) {
      throw new ScheduledMessageNotEditableError();
    }

    const scheduledFor = scheduledForInput
      ? parseOccurrence(scheduledForInput, schedule.timeZone)
      : (
          await this.prisma.scheduledMessageRecipient.findFirst({
            where: {
              tenantId,
              scheduledMessageId: id,
              status: ScheduledMessageRecipientStatus.FAILED,
            },
            orderBy: { scheduledFor: 'desc' },
            select: { scheduledFor: true },
          })
        )?.scheduledFor;

    if (!scheduledFor) {
      return toView(schedule);
    }

    await this.prisma.scheduledMessageRecipient.updateMany({
      where: {
        tenantId,
        scheduledMessageId: id,
        scheduledFor,
        status: ScheduledMessageRecipientStatus.FAILED,
      },
      data: {
        status: ScheduledMessageRecipientStatus.PENDING,
        attempts: 0,
        nextAttemptAt: null,
        errorCode: null,
        errorMessage: null,
        processedAt: null,
      },
    });

    await this.queue.enqueue(JOB_NAMES.SCHEDULED_MESSAGE_SEND, {
      tenantId,
      scheduleId: id,
      scheduledFor: scheduledFor.toISOString(),
    });

    return this.findOne(id);
  }

  async listRecipients(id: string): Promise<
    Array<{
      conversationId: string | null;
      recipientName: string;
      status: ScheduledMessageRecipientStatus;
    }>
  > {
    const { tenantId } = this.tenantContext.requireContext();
    const schedule = await this.requireSchedule(tenantId, id);
    const occurrence = schedule.nextRunAt ?? schedule.scheduledAt;
    const rows = await this.prisma.scheduledMessageRecipient.findMany({
      where: { tenantId, scheduledMessageId: id, scheduledFor: occurrence },
      orderBy: { recipientName: 'asc' },
      select: { conversationId: true, recipientName: true, status: true },
    });
    return rows;
  }

  async logs(id: string): Promise<ScheduledMessageRunLog[]> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireSchedule(tenantId, id);

    const rows = await this.prisma.scheduledMessageRecipient.findMany({
      where: { tenantId, scheduledMessageId: id },
      orderBy: [{ scheduledFor: 'desc' }, { recipientName: 'asc' }],
      take: 500,
    });

    const groups = new Map<string, ScheduledMessageRunLog>();
    for (const row of rows) {
      const key = row.scheduledFor.toISOString();
      let group = groups.get(key);
      if (!group) {
        group = {
          scheduledFor: row.scheduledFor,
          status: ScheduledMessageRecipientStatus.PENDING,
          total: 0,
          sent: 0,
          failed: 0,
          pending: 0,
          recipients: [],
        };
        groups.set(key, group);
      }
      group.total += 1;
      if (row.status === ScheduledMessageRecipientStatus.SENT) group.sent += 1;
      else if (row.status === ScheduledMessageRecipientStatus.FAILED) group.failed += 1;
      else group.pending += 1;

      group.recipients.push({
        id: row.id,
        recipientName: row.recipientName,
        conversationId: row.conversationId,
        destination: row.destination,
        status: row.status,
        attempts: row.attempts,
        externalMessageId: row.externalMessageId,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        processedAt: row.processedAt,
      });
    }

    for (const group of groups.values()) {
      group.status =
        group.failed > 0
          ? ScheduledMessageRecipientStatus.FAILED
          : group.pending > 0
            ? ScheduledMessageRecipientStatus.PENDING
            : ScheduledMessageRecipientStatus.SENT;
    }

    return [...groups.values()];
  }

  async readAttachment(id: string): Promise<{
    buffer: Buffer;
    mimeType: string;
    fileName: string;
  }> {
    const { tenantId } = this.tenantContext.requireContext();
    const schedule = await this.requireSchedule(tenantId, id);
    if (!schedule.attachmentStorageKey || !schedule.attachmentMimeType) {
      throw new ScheduledMessageNotFoundError();
    }

    return {
      buffer: await this.storage.get(schedule.attachmentStorageKey),
      mimeType: schedule.attachmentMimeType,
      fileName: schedule.attachmentFileName ?? 'anexo',
    };
  }

  private async requireSchedule(tenantId: string, id: string): Promise<PrismaSchedule> {
    const schedule = await this.prisma.scheduledMessage.findFirst({
      where: { id, tenantId },
      select: SCHEDULE_SELECT,
    });
    if (!schedule) {
      throw new ScheduledMessageNotFoundError();
    }
    return schedule;
  }

  private get timeZone(): string {
    return this.config.get('SCHEDULED_MESSAGE_TIMEZONE');
  }

  private resolveScheduledAt(value: string, timeZone: string): Date {
    if (!isFutureLocalDateTime(value, timeZone)) {
      throw new ScheduledMessageInvalidDateError();
    }
    const date = zonedTimeToUtc(value, timeZone);
    if (!date) {
      throw new ScheduledMessageInvalidDateError('Data e hora inválidas.');
    }
    return date;
  }

  private resolveCreateSchedule(
    recurrence: ScheduledMessageRecurrence,
    input: {
      scheduledAt?: string;
      recurringTime?: string;
      dayOfMonth?: unknown;
      weekdays?: unknown;
    },
    timeZone: string,
  ): ResolvedSchedule {
    if (recurrence === 'ONCE') {
      return {
        weekdays: [],
        dayOfMonth: null,
        recurringTime: null,
        scheduledAt: this.resolveScheduledAt(input.scheduledAt ?? '', timeZone),
      };
    }

    const weekdays = usesWeekdays(recurrence)
      ? resolveWeekdays(recurrence, input.weekdays ?? [])
      : [];
    const recurringTime = this.resolveRecurringTime(
      input.recurringTime,
      input.scheduledAt,
      null,
      timeZone,
    );
    const dayOfMonth =
      recurrence === 'MONTHLY'
        ? this.resolveDayOfMonth(input.dayOfMonth, input.scheduledAt, null, timeZone)
        : null;
    const scheduledAt = nextRecurringOccurrence(
      recurrence,
      { weekdays, dayOfMonth, recurringTime },
      timeZone,
    );
    if (!scheduledAt) {
      throw new ScheduledMessageInvalidDateError();
    }
    return { weekdays, dayOfMonth, recurringTime, scheduledAt };
  }

  private resolveUpdateWeekdays(
    recurrence: ScheduledMessageRecurrence,
    value: unknown,
    current: PrismaSchedule,
    currentOccurrence: Date,
    timeZone: string,
  ): number[] {
    if (!usesWeekdays(recurrence)) {
      return [];
    }
    if (value !== undefined) {
      return parseWeekdays(value);
    }
    if (usesWeekdays(current.recurrence)) {
      if (current.weekdays.length > 0) {
        return [...current.weekdays].sort((left, right) => left - right);
      }
      if (current.recurrence === 'DAILY') {
        return [...ALL_WEEKDAYS];
      }
      return [localIsoWeekday(currentOccurrence, timeZone)];
    }
    throw new ScheduledMessageInvalidWeekdaysError();
  }

  private currentRecurringConfig(
    current: PrismaSchedule,
    currentOccurrence: Date,
    timeZone: string,
  ): { weekdays: number[]; dayOfMonth: number | null; recurringTime: string } {
    const weekdays = usesWeekdays(current.recurrence)
      ? current.weekdays.length > 0
        ? [...current.weekdays].sort((left, right) => left - right)
        : current.recurrence === 'DAILY'
          ? [...ALL_WEEKDAYS]
          : [localIsoWeekday(currentOccurrence, timeZone)]
      : [];
    const dayOfMonth =
      current.recurrence === 'MONTHLY'
        ? (current.dayOfMonth ?? localDayOfMonth(current.scheduledAt, timeZone))
        : null;
    const recurringTime =
      parseTimeOfDay(current.recurringTime) ?? localTimeOf(current.scheduledAt, timeZone);
    return { weekdays, dayOfMonth, recurringTime };
  }

  private resolveRecurringTime(
    value: string | undefined,
    scheduledAtFallback: string | undefined,
    current: { recurringTime: string | null; scheduledAt: Date } | null,
    timeZone: string,
  ): string {
    if (value !== undefined) {
      const parsed = parseTimeOfDay(value);
      if (!parsed) {
        throw new ScheduledMessageInvalidTimeError();
      }
      return parsed;
    }
    if (scheduledAtFallback) {
      const date = zonedTimeToUtc(scheduledAtFallback, timeZone);
      if (!date) {
        throw new ScheduledMessageInvalidDateError('Data e hora inválidas.');
      }
      return localTimeOf(date, timeZone);
    }
    if (current) {
      return parseTimeOfDay(current.recurringTime) ?? localTimeOf(current.scheduledAt, timeZone);
    }
    throw new ScheduledMessageInvalidTimeError();
  }

  private resolveDayOfMonth(
    value: unknown,
    scheduledAtFallback: string | undefined,
    current: { dayOfMonth: number | null; scheduledAt: Date } | null,
    timeZone: string,
  ): number {
    if (value !== undefined) {
      const parsed = parseDayOfMonth(value);
      if (parsed === null) {
        throw new ScheduledMessageInvalidDayOfMonthError();
      }
      return parsed;
    }
    if (scheduledAtFallback) {
      const date = zonedTimeToUtc(scheduledAtFallback, timeZone);
      if (!date) {
        throw new ScheduledMessageInvalidDateError('Data e hora inválidas.');
      }
      return localDayOfMonth(date, timeZone);
    }
    if (current) {
      return current.dayOfMonth ?? localDayOfMonth(current.scheduledAt, timeZone);
    }
    throw new ScheduledMessageInvalidDayOfMonthError();
  }

  private async resolveRecipients(
    tenantId: string,
    conversationIds: string[],
  ): Promise<RecipientDefinition[]> {
    const uniqueIds = [...new Set(conversationIds)];
    if (uniqueIds.length === 0) {
      throw new ScheduledMessageInvalidRecipientsError();
    }
    const maxRecipients = this.config.get('SCHEDULED_MESSAGE_MAX_RECIPIENTS');
    if (uniqueIds.length > maxRecipients) {
      throw new ScheduledMessageTooManyRecipientsError(maxRecipients);
    }

    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId, id: { in: uniqueIds }, deletedAt: null },
      select: {
        id: true,
        contactId: true,
        externalContactId: true,
        externalLid: true,
        preferredAddress: true,
        isGroup: true,
        groupName: true,
        whatsappInstanceId: true,
        contact: { select: { name: true, phone: true } },
      },
    });
    if (conversations.length !== uniqueIds.length) {
      throw new ScheduledMessageInvalidRecipientsError(
        'Uma ou mais conversas não pertencem a esta organização.',
      );
    }

    return conversations.map((conversation) => {
      const destination = pickDestination(
        {
          externalContactId: conversation.externalContactId,
          externalLid: conversation.externalLid,
          contactPhone: conversation.contact?.phone ?? null,
        },
        conversation.preferredAddress,
      );
      if (!destination) {
        throw new ScheduledMessageInvalidRecipientsError(
          'Uma das conversas não possui um número de WhatsApp válido.',
        );
      }
      return {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        recipientName:
          (conversation.isGroup ? conversation.groupName : conversation.contact?.name) ??
          conversation.contact?.phone ??
          'Contato',
        destination: destination.address,
        whatsappInstanceId: conversation.whatsappInstanceId,
        recipientKey: `conversation:${conversation.id}`,
      };
    });
  }

  private async existingRecipients(
    scheduleId: string,
    scheduledFor: Date,
  ): Promise<RecipientDefinition[]> {
    const rows = await this.prisma.scheduledMessageRecipient.findMany({
      where: {
        scheduledMessageId: scheduleId,
        scheduledFor,
        status: {
          in: [
            ScheduledMessageRecipientStatus.PENDING,
            ScheduledMessageRecipientStatus.PROCESSING,
            ScheduledMessageRecipientStatus.SENT,
          ],
        },
      },
      select: {
        conversationId: true,
        contactId: true,
        recipientName: true,
        destination: true,
        whatsappInstanceId: true,
        recipientKey: true,
      },
    });

    return rows.flatMap((row) => {
      if (!row.conversationId || !row.whatsappInstanceId) {
        return [];
      }
      return [
        {
          conversationId: row.conversationId,
          contactId: row.contactId,
          recipientName: row.recipientName,
          destination: row.destination,
          whatsappInstanceId: row.whatsappInstanceId,
          recipientKey: row.recipientKey,
        },
      ];
    });
  }

  private async copyAttachment(
    tenantId: string,
    scheduleId: string,
    source: PrismaSchedule,
  ): Promise<StoredAttachment> {
    if (!source.attachmentStorageKey) {
      return EMPTY_ATTACHMENT;
    }

    const buffer = await this.storage.get(source.attachmentStorageKey);
    const extension = source.attachmentMimeType === 'application/pdf' ? 'pdf' : 'jpg';
    const baseKey = `tenant/${tenantId}/scheduled-messages/${scheduleId}/${randomUUID()}`;
    const storageKey = `${baseKey}.${extension}`;
    await this.storage.put(storageKey, buffer);

    let thumbnailKey: string | null = null;
    if (source.attachmentThumbnailKey) {
      const thumbnail = await this.storage.get(source.attachmentThumbnailKey);
      thumbnailKey = `${baseKey}_thumb.jpg`;
      await this.storage.put(thumbnailKey, thumbnail);
    }

    return {
      storageKey,
      thumbnailKey,
      fileName: source.attachmentFileName,
      mimeType: source.attachmentMimeType,
      size: source.attachmentSize,
    };
  }

  private async storeAttachment(
    tenantId: string,
    scheduleId: string,
    file: ScheduledMessageAttachmentFile | null,
  ): Promise<StoredAttachment> {
    if (!file) {
      return EMPTY_ATTACHMENT;
    }

    const maxBytes = this.config.get('MEDIA_MAX_BYTES');
    if (file.buffer.length > maxBytes) {
      throw new ScheduledMessageAttachmentTooLargeError();
    }

    const isImage = await this.media.isImage(file.buffer);
    const isPdf =
      file.mimeType.toLowerCase().includes('pdf') &&
      file.buffer.subarray(0, 4).toString('ascii') === '%PDF';
    if (!isImage && !isPdf) {
      throw new ScheduledMessageAttachmentInvalidError();
    }

    const baseKey = `tenant/${tenantId}/scheduled-messages/${scheduleId}/${randomUUID()}`;
    if (isImage) {
      const optimized = await this.media.optimizeImage(file.buffer);
      const thumbnail = await this.media.makeThumbnail(file.buffer);
      const storageKey = `${baseKey}.${optimized.extension}`;
      const thumbnailKey = `${baseKey}_thumb.${thumbnail.extension}`;
      await this.storage.put(storageKey, optimized.buffer);
      await this.storage.put(thumbnailKey, thumbnail.buffer);
      return {
        storageKey,
        thumbnailKey,
        fileName: ensureExtension(file.fileName, optimized.extension),
        mimeType: optimized.mimeType,
        size: optimized.size,
      };
    }

    const storageKey = `${baseKey}.pdf`;
    await this.storage.put(storageKey, file.buffer);
    return {
      storageKey,
      thumbnailKey: null,
      fileName: ensureExtension(file.fileName, 'pdf'),
      mimeType: 'application/pdf',
      size: file.buffer.length,
    };
  }

  private async deleteStoredAttachment(attachment: StoredAttachment): Promise<void> {
    const keys = [attachment.storageKey, attachment.thumbnailKey].filter((key): key is string =>
      Boolean(key),
    );
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
  }
}

function parseType(value: string): ScheduledMessageType {
  if (value === 'CAMPAIGN' || value === 'REMINDER') {
    return value as ScheduledMessageType;
  }
  throw new ScheduledMessageInvalidTypeError();
}

function parseRecurrence(value: string): ScheduledMessageRecurrence {
  if (value === 'ONCE' || value === 'DAILY' || value === 'WEEKLY' || value === 'MONTHLY') {
    return value as ScheduledMessageRecurrence;
  }
  throw new ScheduledMessageInvalidDateError('Recorrência inválida.');
}

export function toView(schedule: PrismaSchedule): ScheduledMessageView {
  return {
    id: schedule.id,
    type: schedule.type,
    title: schedule.title,
    content: schedule.content,
    valor: schedule.valor,
    recurrence: schedule.recurrence,
    weekdays: schedule.weekdays,
    dayOfMonth: schedule.dayOfMonth,
    recurringTime: schedule.recurringTime,
    timeZone: schedule.timeZone,
    scheduledAt: schedule.scheduledAt,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    recipientCount: schedule.recipientCount,
    status: schedule.status,
    canceledAt: schedule.canceledAt,
    hasAttachment: Boolean(schedule.attachmentStorageKey),
    attachmentFileName: schedule.attachmentFileName,
    attachmentMimeType: schedule.attachmentMimeType,
    attachmentSize: schedule.attachmentSize,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureExtension(fileName: string, extension: string): string {
  const base = fileName.replace(/[^\w.\- ]/g, '_').trim() || 'anexo';
  return base.includes('.') ? base : `${base}.${extension}`;
}

function parseOccurrence(value: string, timeZone: string): Date {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  const local = zonedTimeToUtc(value, timeZone);
  if (!local) {
    throw new ScheduledMessageInvalidDateError('Data e hora inválidas.');
  }
  return local;
}
