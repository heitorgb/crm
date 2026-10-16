import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingChargeStatus, BillingReminderStatus, Prisma } from '@prisma/client';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import {
  EvolutionClient,
  EvolutionRequestError,
  EvolutionUnavailableError,
} from '../whatsapp/evolution/evolution.client.js';
import { BillingRecurrencesService } from './billing-recurrences.service.js';
import { BillingSettingsService, type BillingSettingsView } from './billing-settings.service.js';
import {
  BILLING_MAX_REMINDER_ATTEMPTS,
  BILLING_STALE_PROCESSING_MS,
} from './billing.constants.js';
import { backoffDelayMs, formatCurrencyBRL, renderReminderTemplate } from './billing-message.js';
import { addDays, formatDateOnly, localDateString, localHour, parseDateOnly } from './billing-time.js';
import type { ListBillingRemindersQueryDto } from './dto/reminder.dto.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const MAX_ERROR_LENGTH = 300;

export interface BillingReminderView {
  id: string;
  chargeId: string;
  offsetDays: number;
  scheduledFor: string;
  status: BillingReminderStatus;
  attempts: number;
  destination: string | null;
  whatsappInstanceId: string | null;
  externalMessageId: string | null;
  errorMessage: string | null;
  processedAt: Date | null;
  createdAt: Date;
}

type ReminderOutcome = 'sent' | 'skipped' | 'retry' | 'failed' | 'ignored';

@Injectable()
export class BillingRemindersService {
  private readonly logger = new Logger(BillingRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
    private readonly evolution: EvolutionClient,
    private readonly settings: BillingSettingsService,
    private readonly recurrences: BillingRecurrencesService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  private get timeZone(): string {
    return this.config.get('BILLING_TIMEZONE') ?? 'America/Sao_Paulo';
  }

  async list(query: ListBillingRemindersQueryDto): Promise<PageResult<BillingReminderView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.BillingReminderWhereInput = { tenantId };
    if (query.status) where.status = query.status as BillingReminderStatus;
    if (query.chargeId) where.chargeId = query.chargeId;

    const [total, reminders] = await this.prisma.$transaction([
      this.prisma.billingReminder.count({ where }),
      this.prisma.billingReminder.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(reminders.map(toView), total, query.page, query.perPage);
  }

  /** Full scan executed by the periodic job: recurrences, reminders and dispatch. */
  async runScan(): Promise<void> {
    const today = localDateString(new Date(), this.timeZone);
    try {
      await this.recurrences.generateDue(today);
      await this.generateReminders(today);
      await this.resetStaleProcessing();
      await this.dispatch(today);
    } catch (error) {
      this.logger.warn(
        `Billing scan failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Creates the reminder row for every charge whose scheduled offset falls on
   * `today`. The unique (chargeId, offsetDays) constraint plus skipDuplicates
   * make repeated scans idempotent: a given charge/step pair is created once.
   */
  async generateReminders(today: string): Promise<number> {
    const tenantRows = await this.prisma.billingCharge.findMany({
      where: { status: BillingChargeStatus.PENDING },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    let created = 0;
    for (const { tenantId } of tenantRows) {
      const settings = await this.settings.getForTenant(tenantId);
      if (!settings.remindersEnabled || settings.reminderOffsets.length === 0) {
        continue;
      }

      for (const offset of settings.reminderOffsets) {
        const targetDueDate = addDays(today, -offset);
        const charges = await this.prisma.billingCharge.findMany({
          where: {
            tenantId,
            status: BillingChargeStatus.PENDING,
            dueDate: parseDateOnly(targetDueDate),
          },
          select: { id: true },
        });
        if (charges.length === 0) {
          continue;
        }

        const result = await this.prisma.billingReminder.createMany({
          data: charges.map((charge) => ({
            tenantId,
            chargeId: charge.id,
            offsetDays: offset,
            scheduledFor: parseDateOnly(today),
            status: BillingReminderStatus.PENDING,
            nextAttemptAt: new Date(),
          })),
          skipDuplicates: true,
        });
        created += result.count;
      }
    }

    return created;
  }

  private async resetStaleProcessing(): Promise<void> {
    await this.prisma.billingReminder.updateMany({
      where: {
        status: BillingReminderStatus.PROCESSING,
        updatedAt: { lt: new Date(Date.now() - BILLING_STALE_PROCESSING_MS) },
      },
      data: { status: BillingReminderStatus.PENDING, nextAttemptAt: new Date() },
    });
  }

  private async dispatch(today: string): Promise<void> {
    const due = await this.prisma.billingReminder.findMany({
      where: {
        status: BillingReminderStatus.PENDING,
        scheduledFor: { lte: parseDateOnly(today) },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true, tenantId: true },
    });

    for (const reminder of due) {
      await this.queue.enqueue(JOB_NAMES.BILLING_REMINDER_SEND, {
        tenantId: reminder.tenantId,
        reminderId: reminder.id,
      });
    }
  }

  /** Queue processor. Never throws for expected business outcomes. */
  async processReminder(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const reminderId = asString(payload.reminderId);
    if (!tenantId || !reminderId) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const outcome = await this.attemptSend(tenantId, reminderId);
      if (outcome === 'retry') {
        this.logger.debug(`Reminder ${reminderId} scheduled for a retry`);
      }
    });
  }

  async attemptSend(tenantId: string, reminderId: string): Promise<ReminderOutcome> {
    const reminder = await this.prisma.billingReminder.findFirst({
      where: { id: reminderId, tenantId },
      include: {
        charge: {
          include: {
            customer: { select: { name: true } },
            contact: { select: { phone: true } },
          },
        },
      },
    });
    if (!reminder || reminder.status !== BillingReminderStatus.PENDING) {
      return 'ignored';
    }

    const charge = reminder.charge;
    if (charge.status !== BillingChargeStatus.PENDING) {
      await this.markSkipped(reminder.id, 'charge_closed');
      return 'skipped';
    }

    const settings = await this.settings.getForTenant(tenantId);
    if (!this.withinSendWindow(settings)) {
      return 'retry';
    }

    const phone = await this.resolveDestination(tenantId, charge);
    if (!phone) {
      await this.markSkipped(reminder.id, 'missing_phone');
      return 'skipped';
    }

    const instance = await this.resolveInstance(tenantId, settings);
    if (!instance) {
      return this.registerFailure(reminder.id, reminder.attempts + 1, phone, null, 'no_instance');
    }

    const claim = await this.prisma.billingReminder.updateMany({
      where: { id: reminder.id, status: BillingReminderStatus.PENDING },
      data: {
        status: BillingReminderStatus.PROCESSING,
        destination: phone,
        whatsappInstanceId: instance.id,
        nextAttemptAt: null,
      },
    });
    if (claim.count === 0) {
      return 'ignored';
    }
    const attempt = reminder.attempts + 1;

    const text = renderReminderTemplate(settings.messageTemplate, {
      cliente: charge.customer.name,
      descricao: charge.description,
      valor: formatCurrencyBRL(charge.amountCents),
      vencimento: formatDateOnly(charge.dueDate),
    });

    try {
      if (!this.evolution.configured) {
        throw new EvolutionUnavailableError();
      }
      const sent = await this.evolution.sendText(instance.instanceName, phone, text);
      await this.prisma.billingReminder.updateMany({
        where: { id: reminder.id, status: BillingReminderStatus.PROCESSING },
        data: {
          status: BillingReminderStatus.SENT,
          attempts: attempt,
          externalMessageId: sent.externalMessageId ?? null,
          errorMessage: null,
          processedAt: new Date(),
          nextAttemptAt: null,
        },
      });
      return 'sent';
    } catch (error) {
      return this.registerFailure(reminder.id, attempt, phone, instance.id, describeError(error));
    }
  }

  private async registerFailure(
    reminderId: string,
    attempt: number,
    destination: string,
    instanceId: string | null,
    reason: string,
  ): Promise<ReminderOutcome> {
    const finalAttempt = attempt >= BILLING_MAX_REMINDER_ATTEMPTS;
    await this.prisma.billingReminder.updateMany({
      where: {
        id: reminderId,
        status: { in: [BillingReminderStatus.PENDING, BillingReminderStatus.PROCESSING] },
      },
      data: {
        status: finalAttempt ? BillingReminderStatus.FAILED : BillingReminderStatus.PENDING,
        attempts: attempt,
        destination,
        ...(instanceId ? { whatsappInstanceId: instanceId } : {}),
        errorMessage: reason.slice(0, MAX_ERROR_LENGTH),
        processedAt: finalAttempt ? new Date() : null,
        nextAttemptAt: finalAttempt ? null : new Date(Date.now() + backoffDelayMs(attempt)),
      },
    });
    return finalAttempt ? 'failed' : 'retry';
  }

  private async markSkipped(reminderId: string, reason: string): Promise<void> {
    await this.prisma.billingReminder.updateMany({
      where: { id: reminderId, status: { in: [BillingReminderStatus.PENDING, BillingReminderStatus.PROCESSING] } },
      data: {
        status: BillingReminderStatus.SKIPPED,
        errorMessage: reason,
        processedAt: new Date(),
        nextAttemptAt: null,
      },
    });
  }

  private withinSendWindow(settings: BillingSettingsView): boolean {
    const hour = localHour(new Date(), this.timeZone);
    const { sendWindowStartHour: start, sendWindowEndHour: end } = settings;
    if (start <= end) {
      return hour >= start && hour <= end;
    }
    return hour >= start || hour <= end;
  }

  private async resolveDestination(
    tenantId: string,
    charge: { customerId: string; contact: { phone: string | null } | null },
  ): Promise<string | null> {
    const direct = normalizePhone(charge.contact?.phone);
    if (direct) {
      return direct;
    }

    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, customerId: charge.customerId, phone: { not: null } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { phone: true },
    });
    return normalizePhone(contact?.phone ?? null);
  }

  private async resolveInstance(
    tenantId: string,
    settings: BillingSettingsView,
  ): Promise<{ id: string; instanceName: string } | null> {
    if (settings.whatsappInstanceId) {
      const configured = await this.prisma.whatsAppInstance.findFirst({
        where: { id: settings.whatsappInstanceId, tenantId, active: true },
        select: { id: true, instanceName: true },
      });
      if (configured) {
        return configured;
      }
    }

    return this.prisma.whatsAppInstance.findFirst({
      where: { tenantId, active: true, status: 'CONNECTED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, instanceName: true },
    });
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

function toView(reminder: {
  id: string;
  chargeId: string;
  offsetDays: number;
  scheduledFor: Date;
  status: BillingReminderStatus;
  attempts: number;
  destination: string | null;
  whatsappInstanceId: string | null;
  externalMessageId: string | null;
  errorMessage: string | null;
  processedAt: Date | null;
  createdAt: Date;
}): BillingReminderView {
  return {
    id: reminder.id,
    chargeId: reminder.chargeId,
    offsetDays: reminder.offsetDays,
    scheduledFor: formatDateOnly(reminder.scheduledFor),
    status: reminder.status,
    attempts: reminder.attempts,
    destination: reminder.destination,
    whatsappInstanceId: reminder.whatsappInstanceId,
    externalMessageId: reminder.externalMessageId,
    errorMessage: reminder.errorMessage,
    processedAt: reminder.processedAt,
    createdAt: reminder.createdAt,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function describeError(error: unknown): string {
  if (error instanceof EvolutionRequestError) {
    return error.httpStatus
      ? `evolution_http_${error.httpStatus}`
      : 'evolution_request_failed';
  }
  if (error instanceof EvolutionUnavailableError) {
    return 'evolution_unavailable';
  }
  if (error instanceof AppException) {
    return error.code;
  }
  return 'send_failed';
}
