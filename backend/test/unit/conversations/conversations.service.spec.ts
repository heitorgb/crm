import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { ContactNotFoundError } from '../../../src/modules/contacts/contacts.errors.js';
import {
  ContactPhoneRequiredError,
  WhatsAppInstanceNotFoundError,
} from '../../../src/modules/conversations/conversations.errors.js';
import { ConversationsService } from '../../../src/modules/conversations/conversations.service.js';
import type { ConversationView } from '../../../src/modules/conversations/conversations.service.js';

const context: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'member-1',
  role: 'OWNER',
};

interface PrismaMock {
  contact: { findFirst: ReturnType<typeof vi.fn> };
  whatsAppInstance: { findFirst: ReturnType<typeof vi.fn> };
  conversation: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function createService(): { service: ConversationsService; prisma: PrismaMock } {
  const prisma: PrismaMock = {
    contact: { findFirst: vi.fn() },
    whatsAppInstance: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };

  const tenantContext = {
    requireContext: vi.fn(() => context),
  } as unknown as TenantContextService;

  const service = new ConversationsService(
    prisma as unknown as PrismaService,
    tenantContext,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, prisma };
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
