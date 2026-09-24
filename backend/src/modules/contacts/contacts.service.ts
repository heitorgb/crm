import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  ContactCustomerNotFoundError,
  ContactNotFoundError,
  ContactPhoneConflictError,
} from './contacts.errors.js';
import type { CreateContactDto, ListContactsQueryDto, UpdateContactDto } from './dto/contact.dto.js';

export interface ContactView {
  id: string;
  customerId: string | null;
  customerName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FindOrCreateContactInput {
  tenantId: string;
  phone: string;
  name?: string | null;
}

const CONTACT_INCLUDE = {
  customer: { select: { name: true } },
} satisfies Prisma.ContactInclude;

type PrismaContact = Prisma.ContactGetPayload<{ include: typeof CONTACT_INCLUDE }>;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(query: ListContactsQueryDto): Promise<PageResult<ContactView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.ContactWhereInput = { tenantId };

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, contacts] = await this.prisma.$transaction([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: CONTACT_INCLUDE,
      }),
    ]);

    return buildPage(contacts.map(toContactView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<ContactView> {
    const { tenantId } = this.tenantContext.requireContext();
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId },
      include: CONTACT_INCLUDE,
    });

    if (!contact) {
      throw new ContactNotFoundError();
    }

    return toContactView(contact);
  }

  async create(dto: CreateContactDto): Promise<ContactView> {
    const { tenantId } = this.tenantContext.requireContext();
    if (dto.customerId) {
      await this.requireCustomer(tenantId, dto.customerId);
    }

    try {
      const contact = await this.prisma.contact.create({
        data: {
          tenantId,
          customerId: dto.customerId ?? null,
          name: dto.name.trim(),
          email: normalizeEmail(dto.email),
          phone: normalizePhone(dto.phone),
          position: normalizeNullableString(dto.position),
          isPrimary: dto.isPrimary ?? false,
        },
        include: CONTACT_INCLUDE,
      });

      return toContactView(contact);
    } catch (error) {
      throw mapPhoneConflict(error);
    }
  }

  async update(id: string, dto: UpdateContactDto): Promise<ContactView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireContact(tenantId, id);

    if (dto.customerId) {
      await this.requireCustomer(tenantId, dto.customerId);
    }

    const data: Prisma.ContactUncheckedUpdateInput = {};
    if (dto.customerId !== undefined) data.customerId = dto.customerId;
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.email !== undefined) data.email = normalizeEmail(dto.email);
    if (dto.phone !== undefined) data.phone = normalizePhone(dto.phone);
    if (dto.position !== undefined) data.position = normalizeNullableString(dto.position);
    if (dto.isPrimary !== undefined) data.isPrimary = dto.isPrimary;

    try {
      const contact = await this.prisma.contact.update({
        where: { id },
        data,
        include: CONTACT_INCLUDE,
      });

      return toContactView(contact);
    } catch (error) {
      throw mapPhoneConflict(error);
    }
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.contact.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new ContactNotFoundError();
    }
  }

  /**
   * System lookup used by the WhatsApp webhook, where no tenant context exists.
   * Finds the contact by normalized phone within the tenant or creates a basic one.
   */
  async findOrCreateByPhone(input: FindOrCreateContactInput): Promise<ContactView> {
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new ContactNotFoundError();
    }

    const existing = await this.prisma.contact.findFirst({
      where: { tenantId: input.tenantId, phone },
      include: CONTACT_INCLUDE,
    });
    if (existing) {
      return toContactView(existing);
    }

    const name = normalizeNullableString(input.name) ?? phone;

    try {
      const contact = await this.prisma.contact.create({
        data: { tenantId: input.tenantId, phone, name },
        include: CONTACT_INCLUDE,
      });
      return toContactView(contact);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.contact.findFirst({
          where: { tenantId: input.tenantId, phone },
          include: CONTACT_INCLUDE,
        });
        if (raced) {
          return toContactView(raced);
        }
      }
      throw error;
    }
  }

  private async requireContact(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.contact.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!existing) {
      throw new ContactNotFoundError();
    }
  }

  private async requireCustomer(tenantId: string, customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });

    if (!customer) {
      throw new ContactCustomerNotFoundError();
    }
  }
}

function toContactView(contact: PrismaContact): ContactView {
  return {
    id: contact.id,
    customerId: contact.customerId,
    customerName: contact.customer?.name ?? null,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    position: contact.position,
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function normalizeEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePhone(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function mapPhoneConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ContactPhoneConflictError();
  }
  return error;
}
