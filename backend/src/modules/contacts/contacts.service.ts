import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  formatDateOnly,
  isValidDateOnly,
  parseDateOnly,
} from '../../common/dates/date-only.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { isGroupJid, phoneFromJid } from '../../common/whatsapp/jid.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import {
  ContactCustomerNotFoundError,
  ContactInvalidBirthDateError,
  ContactNotFoundError,
  ContactPhoneConflictError,
} from './contacts.errors.js';
import type {
  CreateContactDto,
  ListContactsQueryDto,
  ResolveContactDto,
  UpdateContactDto,
} from './dto/contact.dto.js';

export interface ContactView {
  id: string;
  customerId: string | null;
  customerName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  address: string | null;
  position: string | null;
  avatarUrl: string | null;
  isPrimary: boolean;
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactListSummary {
  total: number;
  primary: number;
  blocked: number;
  incomplete: number;
}

export type ContactListResult = PageResult<ContactView> & {
  summary?: ContactListSummary;
};

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

export interface WhatsAppContactEventInput {
  tenantId: string;
  jid: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface WhatsAppContactEventResult {
  contactId: string;
  changed: boolean;
  conversationIds: string[];
}

const IMPORT_BATCH_SIZE = 500;

const INCOMPLETE_CONTACT_CONDITIONS: Prisma.ContactWhereInput[] = [
  { phone: null },
  { email: null },
  { birthDate: null },
  { address: null },
];

const CONTACT_INCLUDE = {
  customer: { select: { name: true } },
} satisfies Prisma.ContactInclude;

type PrismaContact = Prisma.ContactGetPayload<{ include: typeof CONTACT_INCLUDE }>;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(query: ListContactsQueryDto): Promise<ContactListResult> {
    const { tenantId } = this.tenantContext.requireContext();
    const summaryWhere = buildContactListWhere({
      tenantId,
      customerId: query.customerId,
      search: query.search,
      extraFilter: query.extraFilter,
    });
    const where = filterContactListWhere(summaryWhere, query.filter);

    if (query.includeSummary) {
      const [total, contacts, summaryTotal, primary, blocked, incomplete] =
        await this.prisma.$transaction([
          this.prisma.contact.count({ where }),
          this.prisma.contact.findMany({
            where,
            orderBy: { [query.sort]: query.order },
            skip: skipOf(query.page, query.perPage),
            take: query.perPage,
            include: CONTACT_INCLUDE,
          }),
          this.prisma.contact.count({ where: summaryWhere }),
          this.prisma.contact.count({ where: { ...summaryWhere, isPrimary: true } }),
          this.prisma.contact.count({ where: { ...summaryWhere, isBlocked: true } }),
          this.prisma.contact.count({
            where: incompleteContactWhere(summaryWhere),
          }),
        ]);

      return {
        ...buildPage(contacts.map(toContactView), total, query.page, query.perPage),
        summary: {
          total: summaryTotal,
          primary,
          blocked,
          incomplete,
        },
      };
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

  /** Idempotent lookup/creation by phone, used by shared-contact messages. */
  async resolveByPhone(input: ResolveContactDto): Promise<ContactView> {
    const { tenantId } = this.tenantContext.requireContext();
    return this.findOrCreateByPhone({
      tenantId,
      phone: input.phone,
      name: input.name ?? null,
    });
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
          birthDate: normalizeBirthDate(dto.birthDate),
          address: normalizeNullableString(dto.address),
          position: normalizeNullableString(dto.position),
          isPrimary: dto.isPrimary ?? false,
          isBlocked: dto.isBlocked ?? false,
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
    if (dto.birthDate !== undefined) data.birthDate = normalizeBirthDate(dto.birthDate);
    if (dto.address !== undefined) data.address = normalizeNullableString(dto.address);
    if (dto.position !== undefined) data.position = normalizeNullableString(dto.position);
    if (dto.isPrimary !== undefined) data.isPrimary = dto.isPrimary;
    if (dto.isBlocked !== undefined) data.isBlocked = dto.isBlocked;

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
        isBlocked: false,
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

  /**
   * Incremental synchronization from an Evolution contact event. The event is
   * resolved to a phone-based contact only; groups, broadcast lists, bots and
   * LID-only identifiers are not turned into CRM contacts (they remain available
   * on the conversation row as their original JID).
   *
   * Manual CRM data wins: a name is only replaced while it is still the phone
   * placeholder and an avatar is only replaced when it is empty or points to a
   * WhatsApp profile picture. Events never delete contacts or conversations.
   */
  async syncFromWhatsAppEvent(
    input: WhatsAppContactEventInput,
  ): Promise<WhatsAppContactEventResult | null> {
    if (isGroupJid(input.jid)) {
      return null;
    }

    const phone = phoneFromJid(input.jid);
    if (!phone) {
      return null;
    }

    const incomingName = normalizeNullableString(input.name) ?? null;
    const incomingAvatar = normalizeNullableString(input.avatarUrl) ?? null;

    let existing = await this.prisma.contact.findFirst({
      where: { tenantId: input.tenantId, phone },
      include: CONTACT_INCLUDE,
    });

    if (!existing) {
      try {
        const created = await this.prisma.contact.create({
          data: {
            tenantId: input.tenantId,
            phone,
            name: incomingName ?? phone,
            avatarUrl: incomingAvatar,
          },
          include: CONTACT_INCLUDE,
        });
        return this.publishContactEvent(input.tenantId, created.id);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        existing = await this.prisma.contact.findFirst({
          where: { tenantId: input.tenantId, phone },
          include: CONTACT_INCLUDE,
        });
        if (!existing) {
          throw error;
        }
      }
    }

    const data: Prisma.ContactUpdateInput = {};
    if (
      incomingName &&
      incomingName !== existing.name &&
      isPlaceholderContactName(existing.name, phone)
    ) {
      data.name = incomingName;
    }
    if (incomingAvatar && shouldReplaceAvatar(existing.avatarUrl, incomingAvatar)) {
      data.avatarUrl = incomingAvatar;
    }

    if (Object.keys(data).length === 0) {
      const conversationIds = await this.conversationIdsForContact(input.tenantId, existing.id);
      return { contactId: existing.id, changed: false, conversationIds };
    }

    await this.prisma.contact.update({ where: { id: existing.id }, data });
    return this.publishContactEvent(input.tenantId, existing.id);
  }

  private async publishContactEvent(
    tenantId: string,
    contactId: string,
  ): Promise<WhatsAppContactEventResult> {
    const conversationIds = await this.conversationIdsForContact(tenantId, contactId);
    this.realtime.emitToTenant(tenantId, 'contact.updated', {
      contactId,
      conversationIds,
    });
    for (const conversationId of conversationIds) {
      this.realtime.emitToTenant(tenantId, 'conversation.updated', {
        conversationId,
      });
    }

    return { contactId, changed: true, conversationIds };
  }

  private async conversationIdsForContact(
    tenantId: string,
    contactId: string,
  ): Promise<string[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId, contactId },
      select: { id: true },
    });
    return conversations.map((conversation) => conversation.id);
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

function buildContactListWhere(input: {
  tenantId: string;
  customerId?: string;
  search?: string;
  extraFilter?: ListContactsQueryDto['extraFilter'];
}): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { tenantId: input.tenantId };

  if (input.customerId) {
    where.customerId = input.customerId;
  }

  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: 'insensitive' } },
      { email: { contains: input.search, mode: 'insensitive' } },
      { phone: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  if (input.extraFilter === 'with_phone') {
    where.phone = { not: null };
  }
  if (input.extraFilter === 'with_email') {
    where.email = { not: null };
  }
  if (input.extraFilter === 'with_birth_date') {
    where.birthDate = { not: null };
  }
  if (input.extraFilter === 'with_address') {
    where.address = { not: null };
  }
  if (input.extraFilter === 'with_customer') {
    where.customerId = { not: null };
  }

  return where;
}

function filterContactListWhere(
  where: Prisma.ContactWhereInput,
  filter: ListContactsQueryDto['filter'],
): Prisma.ContactWhereInput {
  if (filter === 'primary') {
    return { ...where, isPrimary: true };
  }
  if (filter === 'blocked') {
    return { ...where, isBlocked: true };
  }
  if (filter === 'incomplete') {
    return incompleteContactWhere(where);
  }
  return where;
}

function incompleteContactWhere(where: Prisma.ContactWhereInput): Prisma.ContactWhereInput {
  return { AND: [where, { OR: INCOMPLETE_CONTACT_CONDITIONS }] };
}

function toContactView(contact: PrismaContact): ContactView {
  return {
    id: contact.id,
    customerId: contact.customerId,
    customerName: contact.customer?.name ?? null,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    birthDate: contact.birthDate ? formatDateOnly(contact.birthDate) : null,
    address: contact.address,
    position: contact.position,
    avatarUrl: contact.avatarUrl,
    isPrimary: contact.isPrimary,
    isBlocked: contact.isBlocked,
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

function normalizeBirthDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim().length === 0) return null;

  const trimmed = value.trim();
  if (!isValidDateOnly(trimmed)) {
    throw new ContactInvalidBirthDateError();
  }

  return parseDateOnly(trimmed);
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

function isPlaceholderContactName(name: string, phone: string): boolean {
  const trimmed = name.trim();
  return trimmed.length === 0 || normalizePhone(trimmed) === phone;
}

/**
 * Contact avatars are sourced from WhatsApp. A previous WhatsApp picture may be
 * replaced by a newer one, but a picture already stored elsewhere (for example a
 * user-uploaded file path) is preserved.
 */
function shouldReplaceAvatar(current: string | null, incoming: string): boolean {
  if (!current) {
    return true;
  }
  if (current === incoming) {
    return false;
  }
  return isWhatsAppAvatarUrl(current);
}

function isWhatsAppAvatarUrl(value: string): boolean {
  return value.includes('pps.whatsapp.net') || value.startsWith('https://pps.');
}

function mapPhoneConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ContactPhoneConflictError();
  }
  return error;
}
