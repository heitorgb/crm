import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import type { CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './dto/lead.dto.js';
import {
  LeadIdentifierRequiredError,
  LeadNotFoundError,
  LeadPhoneConflictError,
  LeadRelationNotFoundError,
} from './leads.errors.js';

export interface LeadTagView {
  id: string;
  name: string;
  color: string | null;
}

export interface LeadView {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
  contactName: string | null;
  tags: LeadTagView[];
  createdAt: Date;
  updatedAt: Date;
}

const LEAD_INCLUDE = {
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  customer: { select: { name: true } },
  contact: { select: { name: true } },
} satisfies Prisma.LeadInclude;

type PrismaLead = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly activities: ActivitiesService,
  ) {}

  async list(query: ListLeadsQueryDto): Promise<PageResult<LeadView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.LeadWhereInput = { tenantId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (query.tagId) {
      where.tags = { some: { tagId: query.tagId, tenantId } };
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, leads] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: LEAD_INCLUDE,
      }),
    ]);

    return buildPage(leads.map(toLeadView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<LeadView> {
    const { tenantId } = this.tenantContext.requireContext();
    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId }, include: LEAD_INCLUDE });

    if (!lead) {
      throw new LeadNotFoundError();
    }

    return toLeadView(lead);
  }

  async create(dto: CreateLeadDto): Promise<LeadView> {
    const { tenantId } = this.tenantContext.requireContext();
    const name = normalizeNullableString(dto.name);
    const phone = normalizeNullableString(dto.phone);

    if (!name && !phone) {
      throw new LeadIdentifierRequiredError();
    }

    await this.validateRelations(tenantId, dto.customerId, dto.contactId);
    const tagIds = await this.validateTags(tenantId, dto.tagIds);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({
          data: {
            tenantId,
            name,
            phone,
            email: normalizeNullableString(dto.email)?.toLowerCase() ?? null,
            source: normalizeNullableString(dto.source),
            ...(dto.status ? { status: dto.status } : {}),
            customerId: dto.customerId ?? null,
            contactId: dto.contactId ?? null,
          },
        });

        if (tagIds.length > 0) {
          await tx.leadTag.createMany({
            data: tagIds.map((tagId) => ({ tenantId, leadId: lead.id, tagId })),
          });
        }

        return lead.id;
      });

      await this.activities.record({ entity: 'lead', entityId: created, action: 'created' });
      return this.findOne(created);
    } catch (error) {
      throw mapPhoneConflict(error);
    }
  }

  async update(id: string, dto: UpdateLeadDto): Promise<LeadView> {
    const { tenantId } = this.tenantContext.requireContext();
    const existing = await this.prisma.lead.findFirst({ where: { id, tenantId } });

    if (!existing) {
      throw new LeadNotFoundError();
    }

    await this.validateRelations(tenantId, dto.customerId ?? undefined, dto.contactId ?? undefined);
    const tagIds = dto.tagIds ? await this.validateTags(tenantId, dto.tagIds) : undefined;

    const data: Prisma.LeadUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = normalizeNullableString(dto.name);
    if (dto.phone !== undefined) data.phone = normalizeNullableString(dto.phone);
    if (dto.email !== undefined) data.email = normalizeNullableString(dto.email)?.toLowerCase() ?? null;
    if (dto.source !== undefined) data.source = normalizeNullableString(dto.source);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.customerId !== undefined) data.customerId = dto.customerId;
    if (dto.contactId !== undefined) data.contactId = dto.contactId;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.lead.update({ where: { id }, data });
        }

        if (tagIds) {
          await tx.leadTag.deleteMany({ where: { leadId: id, tenantId } });
          if (tagIds.length > 0) {
            await tx.leadTag.createMany({
              data: tagIds.map((tagId) => ({ tenantId, leadId: id, tagId })),
            });
          }
        }
      });
    } catch (error) {
      throw mapPhoneConflict(error);
    }

    if (dto.status !== undefined && dto.status !== existing.status) {
      await this.activities.record({
        entity: 'lead',
        entityId: id,
        action: 'status_changed',
        metadata: { from: existing.status, to: dto.status },
      });
    } else {
      await this.activities.record({ entity: 'lead', entityId: id, action: 'updated' });
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.lead.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new LeadNotFoundError();
    }
  }

  private async validateRelations(
    tenantId: string,
    customerId?: string,
    contactId?: string,
  ): Promise<void> {
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw new LeadRelationNotFoundError();
      }
    }

    if (contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true },
      });
      if (!contact) {
        throw new LeadRelationNotFoundError();
      }
    }
  }

  private async validateTags(tenantId: string, tagIds?: string[]): Promise<string[]> {
    if (!tagIds || tagIds.length === 0) {
      return [];
    }

    const unique = [...new Set(tagIds)];
    const count = await this.prisma.tag.count({ where: { tenantId, id: { in: unique } } });

    if (count !== unique.length) {
      throw new LeadRelationNotFoundError();
    }

    return unique;
  }
}

function toLeadView(lead: PrismaLead): LeadView {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    source: lead.source,
    status: lead.status,
    customerId: lead.customerId,
    customerName: lead.customer?.name ?? null,
    contactId: lead.contactId,
    contactName: lead.contact?.name ?? null,
    tags: lead.tags.map((item) => item.tag),
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapPhoneConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new LeadPhoneConflictError();
  }
  return error;
}
