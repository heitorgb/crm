import { Injectable } from '@nestjs/common';
import { CustomerStatus, Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import {
  CustomerDocumentConflictError,
  CustomerNotFoundError,
  CustomerTagNotFoundError,
} from './customers.errors.js';
import type {
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js';

export interface CustomerTagView {
  id: string;
  name: string;
  color: string | null;
}

export interface CustomerView {
  id: string;
  name: string;
  document: string | null;
  status: CustomerStatus;
  tags: CustomerTagView[];
  contactCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerContactView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerDetailView extends Omit<CustomerView, 'contactCount'> {
  contacts: CustomerContactView[];
}

const CUSTOMER_TAGS_SELECT = {
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.CustomerInclude;

type PrismaCustomerWithTags = Prisma.CustomerGetPayload<{
  include: typeof CUSTOMER_TAGS_SELECT;
}>;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly activities: ActivitiesService,
  ) {}

  async list(query: ListCustomersQueryDto): Promise<PageResult<CustomerView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.CustomerWhereInput = { tenantId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.tagId) {
      where.tags = { some: { tagId: query.tagId, tenantId } };
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { document: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, customers] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: { ...CUSTOMER_TAGS_SELECT, _count: { select: { contacts: true } } },
      }),
    ]);

    return buildPage(
      customers.map((customer) => toCustomerView(customer)),
      total,
      query.page,
      query.perPage,
    );
  }

  async findOne(id: string): Promise<CustomerDetailView> {
    const { tenantId } = this.tenantContext.requireContext();
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        ...CUSTOMER_TAGS_SELECT,
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            position: true,
            isPrimary: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!customer) {
      throw new CustomerNotFoundError();
    }

    return { ...toCustomerBase(customer), contacts: customer.contacts };
  }

  async create(dto: CreateCustomerDto): Promise<CustomerDetailView> {
    const { tenantId } = this.tenantContext.requireContext();
    const tagIds = await this.validateTags(tenantId, dto.tagIds);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            tenantId,
            name: dto.name.trim(),
            document: normalizeDocument(dto.document) ?? null,
            status: dto.status ?? CustomerStatus.ACTIVE,
          },
        });

        if (tagIds.length > 0) {
          await tx.customerTag.createMany({
            data: tagIds.map((tagId) => ({ tenantId, customerId: customer.id, tagId })),
          });
        }

        return customer.id;
      });

      await this.activities.record({ entity: 'customer', entityId: created, action: 'created' });
      return await this.findOne(created);
    } catch (error) {
      throw mapDocumentConflict(error);
    }
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDetailView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireCustomer(tenantId, id);

    const tagIds = dto.tagIds ? await this.validateTags(tenantId, dto.tagIds) : undefined;

    const data: Prisma.CustomerUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.document !== undefined) data.document = normalizeDocument(dto.document) ?? null;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.customer.update({ where: { id }, data });
        }

        if (tagIds) {
          await tx.customerTag.deleteMany({ where: { customerId: id, tenantId } });
          if (tagIds.length > 0) {
            await tx.customerTag.createMany({
              data: tagIds.map((tagId) => ({ tenantId, customerId: id, tagId })),
            });
          }
        }
      });
    } catch (error) {
      throw mapDocumentConflict(error);
    }

    await this.activities.record({ entity: 'customer', entityId: id, action: 'updated' });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.customer.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new CustomerNotFoundError();
    }
  }

  private async requireCustomer(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!existing) {
      throw new CustomerNotFoundError();
    }
  }

  private async validateTags(tenantId: string, tagIds?: string[]): Promise<string[]> {
    if (!tagIds || tagIds.length === 0) {
      return [];
    }

    const unique = [...new Set(tagIds)];
    const count = await this.prisma.tag.count({ where: { tenantId, id: { in: unique } } });

    if (count !== unique.length) {
      throw new CustomerTagNotFoundError();
    }

    return unique;
  }
}

function toCustomerBase(
  customer: PrismaCustomerWithTags,
): Omit<CustomerView, 'contactCount'> {
  return {
    id: customer.id,
    name: customer.name,
    document: customer.document,
    status: customer.status,
    tags: customer.tags.map((item) => item.tag),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function toCustomerView(
  customer: PrismaCustomerWithTags & { _count: { contacts: number } },
): CustomerView {
  return { ...toCustomerBase(customer), contactCount: customer._count.contacts };
}

function normalizeDocument(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapDocumentConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new CustomerDocumentConflictError();
  }

  return error;
}
