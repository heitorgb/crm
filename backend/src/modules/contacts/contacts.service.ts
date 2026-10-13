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
  avatarUrl: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FindOrCreateContactInput {
  tenantId: string;
  phone: string;
  name?: string | null;
}

export interface WhatsAppContactInput {
  phone: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface ImportContactsResult {
  created: number;
  updated: number;
}

const IMPORT_BATCH_SIZE = 500;

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

  /**
   * System import used to bring the WhatsApp address book into the CRM. Tenant is
   * always explicit (like the webhook path, there is no request context). Existing
   * contacts are preserved: a name is only replaced when it is still the phone
   * placeholder, and the avatar is only filled when empty.
   */
  async importFromWhatsApp(
    tenantId: string,
    contacts: WhatsAppContactInput[],
  ): Promise<ImportContactsResult> {
    const deduped = new Map<string, { name: string | null; avatarUrl: string | null }>();
    for (const contact of contacts) {
      const phone = normalizePhone(contact.phone);
      if (!phone) {
        continue;
      }
      const name = normalizeNullableString(contact.name) ?? null;
      const avatarUrl = normalizeNullableString(contact.avatarUrl) ?? null;
      const previous = deduped.get(phone);
      deduped.set(phone, {
        name: previous?.name ?? name,
        avatarUrl: previous?.avatarUrl ?? avatarUrl,
      });
    }

    if (deduped.size === 0) {
      return { created: 0, updated: 0 };
    }

    // Self-heal: drop contacts left behind by earlier address-book imports whose
    // number is no longer part of the book. Only contacts without any linked
    // conversation or customer are eligible, so CRM data is never destroyed.
    await this.prisma.contact.deleteMany({
      where: {
        tenantId,
        customerId: null,
        phone: { not: null, notIn: [...deduped.keys()] },
        conversations: { none: {} },
      },
    });

    const existing = await this.prisma.contact.findMany({
      where: { tenantId, phone: { in: [...deduped.keys()] } },
      select: { id: true, phone: true, name: true, avatarUrl: true },
    });
    const existingByPhone = new Map(existing.map((contact) => [contact.phone as string, contact]));

    const toCreate: Prisma.ContactCreateManyInput[] = [];
    const toUpdate: { id: string; data: Prisma.ContactUpdateInput }[] = [];

    for (const [phone, incoming] of deduped) {
      const current = existingByPhone.get(phone);
      if (!current) {
        toCreate.push({
          tenantId,
          phone,
          name: incoming.name ?? phone,
          avatarUrl: incoming.avatarUrl,
        });
        continue;
      }

      const data: Prisma.ContactUpdateInput = {};
      if (incoming.avatarUrl && !current.avatarUrl) {
        data.avatarUrl = incoming.avatarUrl;
      }
      if (incoming.name && (current.name === phone || current.name.trim().length === 0)) {
        data.name = incoming.name;
      }
      if (Object.keys(data).length > 0) {
        toUpdate.push({ id: current.id, data });
      }
    }

    let created = 0;
    for (let index = 0; index < toCreate.length; index += IMPORT_BATCH_SIZE) {
      const batch = toCreate.slice(index, index + IMPORT_BATCH_SIZE);
      const result = await this.prisma.contact.createMany({ data: batch, skipDuplicates: true });
      created += result.count;
    }

    for (const update of toUpdate) {
      await this.prisma.contact.update({ where: { id: update.id }, data: update.data });
    }

    return { created, updated: toUpdate.length };
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
    avatarUrl: contact.avatarUrl,
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
