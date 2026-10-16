import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  BILLING_DEFAULT_MESSAGE_TEMPLATE,
  BILLING_DEFAULT_REMINDER_OFFSETS,
  BILLING_DEFAULT_SEND_WINDOW_END_HOUR,
  BILLING_DEFAULT_SEND_WINDOW_START_HOUR,
  BILLING_SCAN_INTERVAL_MS,
} from './billing.constants.js';
import { BillingInstanceNotFoundError } from './billing.errors.js';
import { normalizeReminderOffsets } from './billing-message.js';
import type { UpdateBillingSettingsDto } from './dto/settings.dto.js';

export interface BillingSettingsValues {
  remindersEnabled: boolean;
  reminderOffsets: number[];
  messageTemplate: string;
  whatsappInstanceId: string | null;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
}

export interface BillingSettingsView extends BillingSettingsValues {
  /** IANA time zone used to evaluate the send window (read-only). */
  timeZone: string;
  /** How often the scan runs, in minutes (read-only, from the scheduler). */
  scanIntervalMinutes: number;
}

export function defaultBillingSettings(): BillingSettingsValues {
  return {
    remindersEnabled: true,
    reminderOffsets: [...BILLING_DEFAULT_REMINDER_OFFSETS],
    messageTemplate: BILLING_DEFAULT_MESSAGE_TEMPLATE,
    whatsappInstanceId: null,
    sendWindowStartHour: BILLING_DEFAULT_SEND_WINDOW_START_HOUR,
    sendWindowEndHour: BILLING_DEFAULT_SEND_WINDOW_END_HOUR,
  };
}

@Injectable()
export class BillingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get timeZone(): string {
    return this.config.get('BILLING_TIMEZONE') ?? 'America/Sao_Paulo';
  }

  async get(): Promise<BillingSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    return this.getForTenant(tenantId);
  }

  /** System lookup used by the reminder scan where no request context exists. */
  async getForTenant(tenantId: string): Promise<BillingSettingsView> {
    const settings = await this.prisma.billingSettings.findUnique({ where: { tenantId } });
    return this.present(settings ? toValues(settings) : defaultBillingSettings());
  }

  async update(dto: UpdateBillingSettingsDto): Promise<BillingSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();

    if (dto.whatsappInstanceId) {
      const instance = await this.prisma.whatsAppInstance.findFirst({
        where: { id: dto.whatsappInstanceId, tenantId },
        select: { id: true },
      });
      if (!instance) {
        throw new BillingInstanceNotFoundError();
      }
    }

    const data: Prisma.BillingSettingsUncheckedUpdateInput = {};
    if (dto.remindersEnabled !== undefined) data.remindersEnabled = dto.remindersEnabled;
    if (dto.reminderOffsets !== undefined) {
      data.reminderOffsets = normalizeReminderOffsets(dto.reminderOffsets) as Prisma.InputJsonValue;
    }
    if (dto.messageTemplate !== undefined) data.messageTemplate = dto.messageTemplate.trim();
    if (dto.whatsappInstanceId !== undefined) data.whatsappInstanceId = dto.whatsappInstanceId;
    if (dto.sendWindowStartHour !== undefined) data.sendWindowStartHour = dto.sendWindowStartHour;
    if (dto.sendWindowEndHour !== undefined) data.sendWindowEndHour = dto.sendWindowEndHour;

    const current = await this.prisma.billingSettings.findUnique({ where: { tenantId } });
    if (!current) {
      const created = await this.prisma.billingSettings.create({
        data: {
          tenantId,
          remindersEnabled: dto.remindersEnabled ?? defaultBillingSettings().remindersEnabled,
          reminderOffsets: normalizeReminderOffsets(
            dto.reminderOffsets ?? defaultBillingSettings().reminderOffsets,
          ) as Prisma.InputJsonValue,
          messageTemplate: dto.messageTemplate?.trim() ?? defaultBillingSettings().messageTemplate,
          whatsappInstanceId: dto.whatsappInstanceId ?? null,
          sendWindowStartHour:
            dto.sendWindowStartHour ?? defaultBillingSettings().sendWindowStartHour,
          sendWindowEndHour: dto.sendWindowEndHour ?? defaultBillingSettings().sendWindowEndHour,
        },
      });
      return this.present(toValues(created));
    }

    const updated = await this.prisma.billingSettings.update({ where: { tenantId }, data });
    return this.present(toValues(updated));
  }

  private present(values: BillingSettingsValues): BillingSettingsView {
    return {
      ...values,
      timeZone: this.timeZone,
      scanIntervalMinutes: Math.round(BILLING_SCAN_INTERVAL_MS / 60_000),
    };
  }
}

function toValues(settings: {
  remindersEnabled: boolean;
  reminderOffsets: Prisma.JsonValue;
  messageTemplate: string;
  whatsappInstanceId: string | null;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
}): BillingSettingsValues {
  return {
    remindersEnabled: settings.remindersEnabled,
    reminderOffsets: normalizeReminderOffsets(settings.reminderOffsets),
    messageTemplate: settings.messageTemplate,
    whatsappInstanceId: settings.whatsappInstanceId,
    sendWindowStartHour: settings.sendWindowStartHour,
    sendWindowEndHour: settings.sendWindowEndHour,
  };
}
