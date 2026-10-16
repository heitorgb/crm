import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingChargeStatus, BillingReminderStatus, Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  BillingChargeNotCancelableError,
  BillingChargeNotFoundError,
  BillingChargeNotEditableError,
  BillingChargeNotPayableError,
  BillingInvalidDateError,
} from './billing.errors.js';
import { assertBillingContact, resolveBillingParty } from './billing-party.js';
import {
  addDays,
  formatDateOnly,
  isValidDateOnly,
  localDateString,
  parseDateOnly,
} from './billing-time.js';
import type {
  BillingChargeEffectiveStatus,
  BillingOverviewQueryDto,
  CreateBillingChargeDto,
  ListBillingChargesQueryDto,
  UpdateBillingChargeDto,
} from './dto/charge.dto.js';
import type { CreateBillingRecurrenceDto } from './dto/recurrence.dto.js';
import { BillingRecurrencesService } from './billing-recurrences.service.js';

const CHARGE_INCLUDE = {
  customer: { select: { name: true } },
  contact: { select: { name: true, phone: true } },
} satisfies Prisma.BillingChargeInclude;

type PrismaCharge = Prisma.BillingChargeGetPayload<{ include: typeof CHARGE_INCLUDE }>;

const UPCOMING_LIMIT = 5;

export interface BillingChargeView {
  id: string;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  recurrenceId: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  status: BillingChargeEffectiveStatus;
  paidAt: Date | null;
  paidByUserId: string | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingOverviewView {
  period: { from: string; to: string };
  totalPendingCents: number;
  totalOverdueCents: number;
  totalPaidCents: number;
  pendingCount: number;
  overdueCount: number;
  paidCount: number;
  failedReminders: number;
  upcoming: BillingChargeView[];
}

@Injectable()
export class BillingChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
    private readonly recurrences: BillingRecurrencesService,
  ) {}

  private get timeZone(): string {
    return this.config.get('BILLING_TIMEZONE') ?? 'America/Sao_Paulo';
  }

  private today(): string {
    return localDateString(new Date(), this.timeZone);
  }

  async list(query: ListBillingChargesQueryDto): Promise<PageResult<BillingChargeView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const today = this.today();
    const where = this.buildListWhere(tenantId, query, today);

    const [total, charges] = await this.prisma.$transaction([
      this.prisma.billingCharge.count({ where }),
      this.prisma.billingCharge.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: CHARGE_INCLUDE,
      }),
    ]);

    return buildPage(
      charges.map((charge) => toView(charge, today)),
      total,
      query.page,
      query.perPage,
    );
  }

  async findOne(id: string): Promise<BillingChargeView> {
    const { tenantId } = this.tenantContext.requireContext();
    const charge = await this.prisma.billingCharge.findFirst({
      where: { id, tenantId },
      include: CHARGE_INCLUDE,
    });
    if (!charge) {
      throw new BillingChargeNotFoundError();
    }
    return toView(charge, this.today());
  }

  async create(dto: CreateBillingChargeDto): Promise<BillingChargeView> {
    const { tenantId } = this.tenantContext.requireContext();
    const dueDate = requireDateOnly(dto.dueDate, 'dueDate');

    const party = await resolveBillingParty(
      this.prisma,
      tenantId,
      dto.customerId,
      dto.contactId,
    );

    if (dto.recurrence) {
      const recurrenceInput: CreateBillingRecurrenceDto = {
        customerId: party.customerId ?? undefined,
        contactId: party.contactId ?? undefined,
        description: dto.description,
        amountCents: dto.amountCents,
        startDate: dueDate,
        endDate: dto.recurrence.endDate,
        frequency: dto.recurrence.frequency,
      };

      const chargeId = await this.prisma.$transaction(async (tx) => {
        const { firstChargeId } = await this.recurrences.createForTenant(
          tenantId,
          recurrenceInput,
          tx,
        );
        return firstChargeId;
      });

      return this.findOne(chargeId);
    }

    const charge = await this.prisma.billingCharge.create({
      data: {
        tenantId,
        customerId: party.customerId,
        contactId: party.contactId,
        description: dto.description.trim(),
        amountCents: dto.amountCents,
        dueDate: parseDateOnly(dueDate),
      },
      include: CHARGE_INCLUDE,
    });
    return toView(charge, this.today());
  }

  async update(id: string, dto: UpdateBillingChargeDto): Promise<BillingChargeView> {
    const { tenantId } = this.tenantContext.requireContext();
    const current = await this.requireCharge(tenantId, id);

    if (current.status !== BillingChargeStatus.PENDING) {
      throw new BillingChargeNotEditableError();
    }

    const data: Prisma.BillingChargeUncheckedUpdateInput = {};
    if (dto.contactId !== undefined && dto.contactId !== null) {
      const contactCustomerId = await assertBillingContact(
        this.prisma,
        tenantId,
        dto.contactId,
        current.customerId,
      );
      data.contactId = dto.contactId;
      if (contactCustomerId) {
        data.customerId = contactCustomerId;
      }
    } else if (dto.contactId === null) {
      data.contactId = null;
    }

    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.amountCents !== undefined) data.amountCents = dto.amountCents;
    if (dto.dueDate !== undefined) data.dueDate = parseDateOnly(requireDateOnly(dto.dueDate, 'dueDate'));

    const charge = await this.prisma.billingCharge.update({
      where: { id },
      data,
      include: CHARGE_INCLUDE,
    });
    return toView(charge, this.today());
  }

  async pay(id: string): Promise<BillingChargeView> {
    const { tenantId, userId } = this.tenantContext.requireContext();
    const now = new Date();

    const result = await this.prisma.billingCharge.updateMany({
      where: { id, tenantId, status: BillingChargeStatus.PENDING },
      data: { status: BillingChargeStatus.PAID, paidAt: now, paidByUserId: userId },
    });
    if (result.count === 0) {
      await this.requireCharge(tenantId, id);
      throw new BillingChargeNotPayableError();
    }

    await this.stopReminders(tenantId, id, 'charge_paid');
    return this.findOne(id);
  }

  async cancel(id: string): Promise<BillingChargeView> {
    const { tenantId } = this.tenantContext.requireContext();

    const result = await this.prisma.billingCharge.updateMany({
      where: { id, tenantId, status: BillingChargeStatus.PENDING },
      data: { status: BillingChargeStatus.CANCELED, canceledAt: new Date() },
    });
    if (result.count === 0) {
      await this.requireCharge(tenantId, id);
      throw new BillingChargeNotCancelableError();
    }

    await this.stopReminders(tenantId, id, 'charge_canceled');
    return this.findOne(id);
  }

  async overview(query: BillingOverviewQueryDto): Promise<BillingOverviewView> {
    const { tenantId } = this.tenantContext.requireContext();
    const today = this.today();
    const from = query.from ?? `${today.slice(0, 7)}-01`;
    const to = query.to ?? today;

    const fromDate = parseDateOnly(requireDateOnly(from, 'from'));
    const toExclusive = parseDateOnly(addDays(requireDateOnly(to, 'to'), 1));

    const [
      pendingAgg,
      overdueAgg,
      paidAgg,
      pendingCount,
      overdueCount,
      paidCount,
      failedReminders,
      upcoming,
    ] = await this.prisma.$transaction([
      this.prisma.billingCharge.aggregate({
        where: { tenantId, status: BillingChargeStatus.PENDING, dueDate: { gte: parseDateOnly(today) } },
        _sum: { amountCents: true },
      }),
      this.prisma.billingCharge.aggregate({
        where: { tenantId, status: BillingChargeStatus.PENDING, dueDate: { lt: parseDateOnly(today) } },
        _sum: { amountCents: true },
      }),
      this.prisma.billingCharge.aggregate({
        where: {
          tenantId,
          status: BillingChargeStatus.PAID,
          paidAt: { gte: fromDate, lt: toExclusive },
        },
        _sum: { amountCents: true },
      }),
      this.prisma.billingCharge.count({
        where: { tenantId, status: BillingChargeStatus.PENDING, dueDate: { gte: parseDateOnly(today) } },
      }),
      this.prisma.billingCharge.count({
        where: { tenantId, status: BillingChargeStatus.PENDING, dueDate: { lt: parseDateOnly(today) } },
      }),
      this.prisma.billingCharge.count({
        where: {
          tenantId,
          status: BillingChargeStatus.PAID,
          paidAt: { gte: fromDate, lt: toExclusive },
        },
      }),
      this.prisma.billingReminder.count({
        where: { tenantId, status: BillingReminderStatus.FAILED },
      }),
      this.prisma.billingCharge.findMany({
        where: { tenantId, status: BillingChargeStatus.PENDING, dueDate: { gte: parseDateOnly(today) } },
        orderBy: { dueDate: 'asc' },
        take: UPCOMING_LIMIT,
        include: CHARGE_INCLUDE,
      }),
    ]);

    return {
      period: { from, to },
      totalPendingCents: pendingAgg._sum.amountCents ?? 0,
      totalOverdueCents: overdueAgg._sum.amountCents ?? 0,
      totalPaidCents: paidAgg._sum.amountCents ?? 0,
      pendingCount,
      overdueCount,
      paidCount,
      failedReminders,
      upcoming: upcoming.map((charge) => toView(charge, today)),
    };
  }

  private buildListWhere(
    tenantId: string,
    query: ListBillingChargesQueryDto,
    today: string,
  ): Prisma.BillingChargeWhereInput {
    const where: Prisma.BillingChargeWhereInput = { tenantId };

    if (query.status === 'OVERDUE') {
      where.status = BillingChargeStatus.PENDING;
      where.dueDate = { lt: parseDateOnly(today) };
    } else if (query.status === 'PENDING') {
      where.status = BillingChargeStatus.PENDING;
      where.dueDate = { gte: parseDateOnly(today) };
    } else if (query.status) {
      where.status = query.status as BillingChargeStatus;
    }

    if (query.customerId) where.customerId = query.customerId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.recurrenceId) where.recurrenceId = query.recurrenceId;

    const dueRange: Prisma.DateTimeFilter = {};
    if (query.dueFrom) dueRange.gte = parseDateOnly(requireDateOnly(query.dueFrom, 'dueFrom'));
    if (query.dueTo) dueRange.lte = parseDateOnly(requireDateOnly(query.dueTo, 'dueTo'));
    if (Object.keys(dueRange).length > 0) {
      where.dueDate = { ...(where.dueDate as object), ...dueRange };
    }

    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  private async stopReminders(
    tenantId: string,
    chargeId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.billingReminder.updateMany({
      where: {
        tenantId,
        chargeId,
        status: { in: [BillingReminderStatus.PENDING, BillingReminderStatus.PROCESSING] },
      },
      data: {
        status: BillingReminderStatus.SKIPPED,
        errorMessage: reason,
        processedAt: new Date(),
        nextAttemptAt: null,
      },
    });
  }

  private async requireCharge(tenantId: string, id: string) {
    const charge = await this.prisma.billingCharge.findFirst({ where: { id, tenantId } });
    if (!charge) {
      throw new BillingChargeNotFoundError();
    }
    return charge;
  }
}

export function toView(charge: PrismaCharge, today: string): BillingChargeView {
  return {
    id: charge.id,
    customerId: charge.customerId,
    customerName: charge.customer?.name ?? null,
    contactId: charge.contactId,
    contactName: charge.contact?.name ?? null,
    contactPhone: charge.contact?.phone ?? null,
    recurrenceId: charge.recurrenceId,
    description: charge.description,
    amountCents: charge.amountCents,
    dueDate: formatDateOnly(charge.dueDate),
    status: effectiveStatus(charge, today),
    paidAt: charge.paidAt,
    paidByUserId: charge.paidByUserId,
    canceledAt: charge.canceledAt,
    createdAt: charge.createdAt,
    updatedAt: charge.updatedAt,
  };
}

function effectiveStatus(
  charge: { status: BillingChargeStatus; dueDate: Date },
  today: string,
): BillingChargeEffectiveStatus {
  if (charge.status === BillingChargeStatus.PAID) return 'PAID';
  if (charge.status === BillingChargeStatus.CANCELED) return 'CANCELED';
  return formatDateOnly(charge.dueDate) < today ? 'OVERDUE' : 'PENDING';
}

function requireDateOnly(value: string, field: string): string {
  if (!isValidDateOnly(value)) {
    throw new BillingInvalidDateError(`Data inválida em "${field}". Use o formato YYYY-MM-DD.`);
  }
  return value;
}
