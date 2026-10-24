import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import { ContactsService } from '../../../src/modules/contacts/contacts.service.js';

interface Harness {
  service: ContactsService;
  prisma: {
    contact: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    conversation: { findMany: ReturnType<typeof vi.fn> };
  };
  realtime: { emitToTenant: ReturnType<typeof vi.fn> };
}

function contact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contact-1',
    tenantId: 'tenant-1',
    customerId: null,
    name: '5511999999999',
    email: null,
    phone: '5511999999999',
    birthDate: null,
    address: null,
    position: null,
    avatarUrl: null,
    isPrimary: false,
    isBlocked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: null,
    ...overrides,
  };
}

function createHarness(): Harness {
  const prisma = {
    contact: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(contact()),
      update: vi.fn().mockResolvedValue(contact()),
    },
    conversation: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const realtime = { emitToTenant: vi.fn() };
  const service = new ContactsService(
    prisma as unknown as PrismaService,
    {} as unknown as TenantContextService,
    realtime as unknown as RealtimeService,
  );
  return { service, prisma, realtime };
}

describe('ContactsService.syncFromWhatsAppEvent', () => {
  it('creates a phone contact and publishes the update', async () => {
    const { service, prisma, realtime } = createHarness();

    const result = await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
      avatarUrl: 'https://pps.whatsapp.net/a.jpg',
    });

    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        phone: '5511999999999',
        name: 'Ana',
        avatarUrl: 'https://pps.whatsapp.net/a.jpg',
      },
      include: expect.anything(),
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'contact.updated',
      { contactId: 'contact-1', conversationIds: [] },
    );
    expect(result).toEqual({ contactId: 'contact-1', changed: true, conversationIds: [] });
  });

  it('updates a placeholder name and an empty avatar on an existing contact', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.contact.findFirst.mockResolvedValue(contact());
    prisma.conversation.findMany.mockResolvedValue([{ id: 'conversation-1' }]);

    const result = await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
      avatarUrl: 'https://pps.whatsapp.net/a.jpg',
    });

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: { name: 'Ana', avatarUrl: 'https://pps.whatsapp.net/a.jpg' },
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'contact.updated', {
      contactId: 'contact-1',
      conversationIds: ['conversation-1'],
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'conversation.updated', {
      conversationId: 'conversation-1',
    });
    expect(result).toEqual({
      contactId: 'contact-1',
      changed: true,
      conversationIds: ['conversation-1'],
    });
  });

  it('preserves manual CRM data when the provider has no more reliable value', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.contact.findFirst.mockResolvedValue(
      contact({
        name: 'Ana Paula',
        avatarUrl: 'https://cdn.local/avatar.png',
      }),
    );

    const result = await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
      avatarUrl: 'https://pps.whatsapp.net/new.jpg',
    });

    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
    expect(result).toEqual({ contactId: 'contact-1', changed: false, conversationIds: [] });
  });

  it('replaces an older WhatsApp avatar when a newer one is confirmed', async () => {
    const { service, prisma } = createHarness();
    prisma.contact.findFirst.mockResolvedValue(
      contact({
        name: 'Ana Paula',
        avatarUrl: 'https://pps.whatsapp.net/old.jpg',
      }),
    );

    await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
      avatarUrl: 'https://pps.whatsapp.net/new.jpg',
    });

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: { avatarUrl: 'https://pps.whatsapp.net/new.jpg' },
    });
  });

  it('keeps the previous photo when the provider could not fetch a new one', async () => {
    const { service, prisma } = createHarness();
    prisma.contact.findFirst.mockResolvedValue(
      contact({
        name: 'Ana',
        avatarUrl: 'https://pps.whatsapp.net/existing.jpg',
      }),
    );

    const result = await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
      avatarUrl: null,
    });

    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(result?.changed).toBe(false);
  });

  it('does not create duplicates for repeated events', async () => {
    const { service, prisma } = createHarness();
    prisma.contact.findFirst.mockResolvedValue(contact({ name: 'Ana' }));

    await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
    });

    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', phone: '5511999999999' },
      include: expect.anything(),
    });
  });

  it('ignores groups and identifiers without a conventional phone', async () => {
    const { service, prisma } = createHarness();

    const group = await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '120363000000000000@g.us',
      name: 'Grupo',
    });
    const lid = await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-1',
      jid: '75209205874877@lid',
      name: 'Lid',
    });

    expect(group).toBeNull();
    expect(lid).toBeNull();
    expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('keeps events isolated by tenant', async () => {
    const { service, prisma } = createHarness();
    prisma.contact.findFirst.mockResolvedValue(contact({ tenantId: 'tenant-2' }));

    await service.syncFromWhatsAppEvent({
      tenantId: 'tenant-2',
      jid: '5511999999999@s.whatsapp.net',
      name: 'Ana',
    });

    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-2', phone: '5511999999999' } }),
    );
  });
});
