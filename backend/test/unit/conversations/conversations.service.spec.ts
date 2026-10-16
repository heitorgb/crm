import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { ConversationNotFoundError } from '../../../src/modules/conversations/conversations.errors.js';
import { ContactNotFoundError } from '../../../src/modules/contacts/contacts.errors.js';
import {
  ContactPhoneRequiredError,
  WhatsAppInstanceNotFoundError,
} from '../../../src/modules/conversations/conversations.errors.js';
import { ConversationsService } from '../../../src/modules/conversations/conversations.service.js';
import type { ConversationView } from '../../../src/modules/conversations/conversations.service.js';
import type { ListConversationsQueryDto } from '../../../src/modules/conversations/dto/conversation.dto.js';

const context: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

interface PrismaMock {
  contact: { findFirst: ReturnType<typeof vi.fn> };
  message: { findFirst: ReturnType<typeof vi.fn> };
  whatsAppInstance: { findFirst: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
  conversation: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

interface RealtimeMock {
  emitToTenant: ReturnType<typeof vi.fn>;
  emitToConversation: ReturnType<typeof vi.fn>;
}

function createService(): {
  service: ConversationsService;
  prisma: PrismaMock;
  realtime: RealtimeMock;
} {
  const prisma: PrismaMock = {
    contact: { findFirst: vi.fn() },
    message: { findFirst: vi.fn() },
    whatsAppInstance: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    conversation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  const realtime: RealtimeMock = {
    emitToTenant: vi.fn(),
    emitToConversation: vi.fn(),
  };

  const tenantContext = {
    requireContext: vi.fn(() => context),
  } as unknown as TenantContextService;

  const service = new ConversationsService(
    prisma as unknown as PrismaService,
    tenantContext,
    {} as never,
    { findOne: vi.fn() } as never,
    {} as never,
    realtime as never,
    {} as never,
  );

  return { service, prisma, realtime };
}

const conversationView = { id: 'conv-1' } as unknown as ConversationView;

describe('ConversationsService.startFromContact', () => {
  it('creates a conversation with the contact phone as JID', async () => {
    const { service, prisma } = createService();
    prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', phone: '5511999999999' });
    prisma.whatsAppInstance.findFirst.mockResolvedValue({ id: 'instance-1' });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conv-1' });
    const findOne = vi.spyOn(service, 'findOne').mockResolvedValue(conversationView);

    const result = await service.startFromContact({
      contactId: 'contact-1',
      whatsappInstanceId: 'instance-1',
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          whatsappInstanceId: 'instance-1',
          externalContactId: '5511999999999@s.whatsapp.net',
          contactId: 'contact-1',
          status: 'OPEN',
        }),
      }),
    );
    expect(findOne).toHaveBeenCalledWith('conv-1');
    expect(result).toBe(conversationView);
  });

  it('reuses an existing conversation, reopening it and linking the contact', async () => {
    const { service, prisma } = createService();
    prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', phone: '5511999999999' });
    prisma.whatsAppInstance.findFirst.mockResolvedValue({ id: 'instance-1' });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-9',
      status: 'CLOSED',
      contactId: null,
    });
    prisma.conversation.update.mockResolvedValue({});
    vi.spyOn(service, 'findOne').mockResolvedValue({ id: 'conv-9' } as ConversationView);

    await service.startFromContact({ contactId: 'contact-1', whatsappInstanceId: 'instance-1' });

    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-9' },
      data: { status: 'OPEN', closedAt: null, contactId: 'contact-1' },
    });
  });

  it('rejects a contact without a phone', async () => {
    const { service, prisma } = createService();
    prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', phone: null });

    await expect(
      service.startFromContact({ contactId: 'contact-1', whatsappInstanceId: 'instance-1' }),
    ).rejects.toBeInstanceOf(ContactPhoneRequiredError);
  });

  it('rejects an unknown contact (tenant-scoped)', async () => {
    const { service, prisma } = createService();
    prisma.contact.findFirst.mockResolvedValue(null);

    await expect(
      service.startFromContact({ contactId: 'contact-1', whatsappInstanceId: 'instance-1' }),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
  });

  it('rejects an unknown instance (tenant-scoped)', async () => {
    const { service, prisma } = createService();
    prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', phone: '5511999999999' });
    prisma.whatsAppInstance.findFirst.mockResolvedValue(null);

    await expect(
      service.startFromContact({ contactId: 'contact-1', whatsappInstanceId: 'instance-1' }),
    ).rejects.toBeInstanceOf(WhatsAppInstanceNotFoundError);
  });
});

describe('ConversationsService.markAsRead', () => {
  const view = { id: 'conv-1', unreadCount: 0 } as unknown as ConversationView;

  it('advances the read marker to the latest inbound message and publishes the update', async () => {
    const { service, prisma, realtime } = createService();
    const latest = new Date('2026-01-01T10:00:00.000Z');
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      lastReadAt: new Date('2026-01-01T09:00:00.000Z'),
    });
    prisma.message.findFirst.mockResolvedValue({ occurredAt: latest });
    prisma.conversation.update.mockResolvedValue({});
    vi.spyOn(service, 'findOne').mockResolvedValue(view);

    const result = await service.markAsRead('conv-1');

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1', tenantId: 'tenant-1' } }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { lastReadAt: latest },
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'conversation.updated', {
      conversationId: 'conv-1',
    });
    expect(result).toBe(view);
  });

  it('is idempotent and does not update or emit when already read', async () => {
    const { service, prisma, realtime } = createService();
    const readAt = new Date('2026-01-01T10:00:00.000Z');
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1', lastReadAt: readAt });
    prisma.message.findFirst.mockResolvedValue({ occurredAt: readAt });
    vi.spyOn(service, 'findOne').mockResolvedValue(view);

    await service.markAsRead('conv-1');

    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('rejects a conversation from another tenant', async () => {
    const { service, prisma } = createService();
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(service.markAsRead('conv-1')).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});

describe('ConversationsService.unreadTotal', () => {
  it('returns the aggregated unread total for the tenant', async () => {
    const { service, prisma } = createService();
    prisma.$queryRaw.mockResolvedValue([{ total: 7n }]);

    await expect(service.unreadTotal()).resolves.toEqual({ total: 7 });
  });

  it('returns zero when there are no unread messages', async () => {
    const { service, prisma } = createService();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.unreadTotal()).resolves.toEqual({ total: 0 });
  });
});

describe('ConversationsService.softDelete', () => {
  it('logically deletes the conversation and publishes the removal', async () => {
    const { service, prisma, realtime } = createService();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prisma.conversation.update.mockResolvedValue({});

    await service.softDelete('conv-1');

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv-1', tenantId: 'tenant-1', deletedAt: null },
      select: { id: true },
    });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'conversation.deleted', {
      conversationId: 'conv-1',
    });
  });

  it('rejects a conversation from another tenant without deleting or emitting', async () => {
    const { service, prisma, realtime } = createService();
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(service.softDelete('conv-1')).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });
});

describe('ConversationsService.list', () => {
  it('scopes the listing to the tenant and excludes logically deleted conversations', async () => {
    const { service, prisma } = createService();
    prisma.$transaction.mockResolvedValue([0, []]);

    await service.list({ page: 1, perPage: 20 } as ListConversationsQueryDto);

    const expectedWhere = expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null });
    expect(prisma.conversation.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });
});
