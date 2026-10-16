import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingChargeStatus,
  BillingReminderOrigin,
  BillingReminderStatus,
  Prisma,
} from '@prisma/client';
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
import { ConversationProcessingService } from '../conversations/conversation-processing.service.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { ModuleDisabledError } from '../modules/modules.errors.js';
import { ModulesService } from '../modules/modules.service.js';
import { BillingRecurrencesService } from './billing-recurrences.service.js';
import { BillingSettingsService, type BillingSettingsView } from './billing-settings.service.js';
import {
  BillingChargeNotFoundError,
  BillingChargeNotSendableError,
} from './billing.errors.js';
import {
  BILLING_MAX_REMINDER_ATTEMPTS,
  BILLING_REMINDER_CATCHUP_DAYS,
  BILLING_STALE_PROCESSING_MS,
} from './billing.constants.js';
import { backoffDelayMs, formatCurrencyBRL, renderReminderTemplate } from './billing-message.js';
import {
  addDays,
  formatDateBR,
  formatDateOnly,
  isWithinWindow,
  localDateString,
  localHour,
  parseDateOnly,
} from './billing-time.js';
import type { ListBillingRemindersQueryDto } from './dto/reminder.dto.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const MAX_ERROR_LENGTH = 300;

export interface BillingReminderView {
  id: string;
  chargeId: string;
  offsetDays: number;
  origin: BillingReminderOrigin;
  createdByUserId: string | null;
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

const REMINDER_CHARGE_INCLUDE = {
  customer: { select: { name: true } },
  contact: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.BillingChargeInclude;

type ReminderCharge = Prisma.BillingChargeGetPayload<{
  include: typeof REMINDER_CHARGE_INCLUDE;
}>;

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
    private readonly modules: ModulesService,
    private readonly conversations: ConversationProcessingService,
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
   * Creates the reminder row for every charge whose scheduled reminder date
   * (`dueDate + offset`) has already been reached. It matches the exact day and
   * also catches up targets missed in the last `BILLING_REMINDER_CATCHUP_DAYS`
   * days, so a scan outage does not lose an eligible reminder. The unique
   * (chargeId, dedupeKey) constraint plus skipDuplicates keep repeated scans
   * idempotent: a given charge/step pair is created exactly once.
   */
  async generateReminders(today: string): Promise<number> {
    const tenantRows = await this.prisma.billingCharge.findMany({
      where: { status: BillingChargeStatus.PENDING },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    let created = 0;
    for (const { tenantId } of tenantRows) {
      if (!(await this.modules.isEnabled(tenantId, MODULE_KEYS.BILLING_COLLECTION))) {
        continue;
      }

      const settings = await this.settings.getForTenant(tenantId);
      if (!settings.remindersEnabled || settings.reminderOffsets.length === 0) {
        continue;
      }

      for (const offset of settings.reminderOffsets) {
        const earliestDueDate = addDays(today, -BILLING_REMINDER_CATCHUP_DAYS - offset);
        const latestDueDate = addDays(today, -offset);

        const charges = await this.prisma.billingCharge.findMany({
          where: {
            tenantId,
            status: BillingChargeStatus.PENDING,
            dueDate: {
              gte: parseDateOnly(earliestDueDate),
              lte: parseDateOnly(latestDueDate),
            },
          },
          select: { id: true, dueDate: true },
        });
        if (charges.length === 0) {
          continue;
        }

        const result = await this.prisma.billingReminder.createMany({
          data: charges.map((charge) => ({
            tenantId,
            chargeId: charge.id,
            offsetDays: offset,
            origin: BillingReminderOrigin.AUTOMATIC,
            dedupeKey: automaticDedupeKey(offset),
            scheduledFor: parseDateOnly(addDays(formatDateOnly(charge.dueDate), offset)),
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

  /**
   * Enqueues the send job for pending reminders. Tenants with automation
   * disabled are skipped entirely, and sends are only enqueued while the
   * configured window is open, so jobs are not created just to be rejected.
   */
  private async dispatch(today: string): Promise<void> {
    const due = await this.prisma.billingReminder.findMany({
      where: {
        status: BillingReminderStatus.PENDING,
        scheduledFor: { lte: parseDateOnly(today) },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true, tenantId: true },
    });

    const settingsByTenant = new Map<string, BillingSettingsView>();
    const collectionEnabledByTenant = new Map<string, boolean>();
    for (const reminder of due) {
      let collectionEnabled = collectionEnabledByTenant.get(reminder.tenantId);
      if (collectionEnabled === undefined) {
        collectionEnabled = await this.modules.isEnabled(
          reminder.tenantId,
          MODULE_KEYS.BILLING_COLLECTION,
        );
        collectionEnabledByTenant.set(reminder.tenantId, collectionEnabled);
      }
      if (!collectionEnabled) {
        continue;
      }

      let settings = settingsByTenant.get(reminder.tenantId);
      if (!settings) {
        settings = await this.settings.getForTenant(reminder.tenantId);
        settingsByTenant.set(reminder.tenantId, settings);
      }
      if (!settings.remindersEnabled || !this.isWindowOpen(settings)) {
        continue;
      }

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

    if (!(await this.modules.isEnabled(tenantId, MODULE_KEYS.BILLING_COLLECTION))) {
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
    const reminder = await this.loadReminder(tenantId, reminderId);
    if (!reminder || reminder.status !== BillingReminderStatus.PENDING) {
      return 'ignored';
    }

    const charge = reminder.charge;
    if (charge.status !== BillingChargeStatus.PENDING) {
      await this.markSkipped(reminder.id, 'charge_closed');
      return 'skipped';
    }

    const settings = await this.settings.getForTenant(tenantId);
    if (!settings.remindersEnabled) {
      return 'retry';
    }
    if (!this.isWindowOpen(settings)) {
      return 'retry';
    }

    const destination = await this.resolveDestination(tenantId, charge);
    const instance = await this.resolveInstance(tenantId, settings);

    return this.deliver({
      reminderId: reminder.id,
      attempt: reminder.attempts + 1,
      charge,
      settings,
      destination,
      instance,
      maxAttempts: BILLING_MAX_REMINDER_ATTEMPTS,
    });
  }

  /**
   * Explicit user action: sends a reminder right away, ignoring the automatic
   * schedule and send window. Paid/canceled charges are blocked. Idempotent by
   * (chargeId, idempotencyKey) so a duplicated request returns the recorded
   * attempt without sending again, while new explicit actions still work.
   */
  async sendManual(chargeId: string, idempotencyKey: string): Promise<BillingReminderView> {
    const { tenantId, userId } = this.tenantContext.requireContext();

    if (!(await this.modules.isEnabled(tenantId, MODULE_KEYS.BILLING_COLLECTION))) {
      throw new ModuleDisabledError(MODULE_KEYS.BILLING_COLLECTION);
    }

    const existing = await this.prisma.billingReminder.findFirst({
      where: { tenantId, chargeId, idempotencyKey },
    });
    if (existing) {
      return toView(existing);
    }

    const charge = await this.prisma.billingCharge.findFirst({
      where: { id: chargeId, tenantId },
      include: REMINDER_CHARGE_INCLUDE,
    });
    if (!charge) {
      throw new BillingChargeNotFoundError();
    }
    if (charge.status !== BillingChargeStatus.PENDING) {
      throw new BillingChargeNotSendableError();
    }

    const settings = await this.settings.getForTenant(tenantId);
    const destination = await this.resolveDestination(tenantId, charge);
    const instance = await this.resolveInstance(tenantId, settings);

    let reminder;
    try {
      reminder = await this.prisma.billingReminder.create({
        data: {
          tenantId,
          chargeId,
          offsetDays: 0,
          origin: BillingReminderOrigin.MANUAL,
          createdByUserId: userId,
          idempotencyKey,
          scheduledFor: parseDateOnly(localDateString(new Date(), this.timeZone)),
          status: BillingReminderStatus.PENDING,
          destination: destination?.phone ?? null,
          whatsappInstanceId: instance?.id ?? null,
          nextAttemptAt: null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.billingReminder.findFirst({
          where: { tenantId, chargeId, idempotencyKey },
        });
        if (raced) {
          return toView(raced);
        }
      }
      throw error;
    }

    await this.deliver({
      reminderId: reminder.id,
      attempt: 1,
      charge,
      settings,
      destination,
      instance,
      maxAttempts: 1,
    });

    const final = await this.prisma.billingReminder.findUniqueOrThrow({ where: { id: reminder.id } });
    return toView(final);
  }

  /** Shared delivery path for automatic and manual reminders. */
  private async deliver(params: {
    reminderId: string;
    attempt: number;
    charge: ReminderCharge;
    settings: BillingSettingsView;
    destination: { phone: string; contactId: string | null } | null;
    instance: { id: string; instanceName: string } | null;
    maxAttempts: number;
  }): Promise<ReminderOutcome> {
    const { reminderId, attempt, charge, settings, destination, instance, maxAttempts } = params;

    if (!destination) {
      await this.markSkipped(reminderId, 'missing_phone');
      return 'skipped';
    }
    const phone = destination.phone;
    if (!instance) {
      return this.registerFailure(reminderId, attempt, phone, null, 'no_instance', maxAttempts);
    }

    const claim = await this.prisma.billingReminder.updateMany({
      where: { id: reminderId, status: BillingReminderStatus.PENDING },
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

    const text = renderReminderTemplate(settings.messageTemplate, {
      cliente: charge.contact?.name ?? charge.customer?.name ?? 'cliente',
      descricao: charge.description,
      valor: formatCurrencyBRL(charge.amountCents),
      vencimento: formatDateBR(charge.dueDate),
      nome_empresa: await this.resolveCompanyName(charge.tenantId),
    });

    try {
      if (!this.evolution.configured) {
        throw new EvolutionUnavailableError();
      }
      const sent = await this.evolution.sendText(instance.instanceName, phone, text);
      await this.prisma.billingReminder.updateMany({
        where: { id: reminderId, status: BillingReminderStatus.PROCESSING },
        data: {
          status: BillingReminderStatus.SENT,
          attempts: attempt,
          externalMessageId: sent.externalMessageId ?? null,
          errorMessage: null,
          processedAt: new Date(),
          nextAttemptAt: null,
        },
      });

      // The message is recorded in the conversation after the provider confirms
      // the send. A failure here never rolls the reminder back to PENDING (which
      // would re-send the message) and never drops the audit history.
      try {
        await this.conversations.recordOutboundMessage({
          tenantId: charge.tenantId,
          whatsappInstanceId: instance.id,
          externalContactId: `${phone}@s.whatsapp.net`,
          contactId: destination.contactId,
          text,
          externalMessageId: sent.externalMessageId ?? null,
          metadata: { source: 'billing_reminder', chargeId: charge.id, reminderId },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to record reminder ${reminderId} in the conversation: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }

      return 'sent';
    } catch (error) {
      return this.registerFailure(
        reminderId,
        attempt,
        phone,
        instance.id,
        describeError(error),
        maxAttempts,
      );
    }
  }

  private async resolveCompanyName(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name?.trim() ?? '';
  }

  private async registerFailure(
    reminderId: string,
    attempt: number,
    destination: string,
    instanceId: string | null,
    reason: string,
    maxAttempts: number,
  ): Promise<ReminderOutcome> {
    const finalAttempt = attempt >= maxAttempts;
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

  private loadReminder(tenantId: string, reminderId: string) {
    return this.prisma.billingReminder.findFirst({
      where: { id: reminderId, tenantId },
      include: { charge: { include: REMINDER_CHARGE_INCLUDE } },
    });
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

  private isWindowOpen(settings: BillingSettingsView): boolean {
    return isWithinWindow(
      localHour(new Date(), this.timeZone),
      settings.sendWindowStartHour,
      settings.sendWindowEndHour,
    );
  }

  private async resolveDestination(
    tenantId: string,
    charge: {
      contactId: string | null;
      customerId: string | null;
      contact: { id: string; phone: string | null } | null;
    },
  ): Promise<{ phone: string; contactId: string | null } | null> {
    const direct = normalizePhone(charge.contact?.phone);
    if (direct) {
      return { phone: direct, contactId: charge.contact?.id ?? charge.contactId };
    }

    if (!charge.customerId) {
      return null;
    }

    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, customerId: charge.customerId, phone: { not: null } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, phone: true },
    });
    const fallbackPhone = normalizePhone(contact?.phone ?? null);
    return fallbackPhone ? { phone: fallbackPhone, contactId: contact?.id ?? null } : null;
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
  origin: BillingReminderOrigin;
  createdByUserId: string | null;
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
    origin: reminder.origin,
    createdByUserId: reminder.createdByUserId,
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

function automaticDedupeKey(offsetDays: number): string {
  return `auto:${offsetDays}`;
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
