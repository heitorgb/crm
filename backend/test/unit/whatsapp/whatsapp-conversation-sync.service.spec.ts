import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import { WhatsAppConversationSyncService } from '../../../src/modules/whatsapp/whatsapp-conversation-sync.service.js';

interface Harness {
  service: WhatsAppConversationSyncService;
  prisma: {
    conversation: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    conversationParticipant: {
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  realtime: { emitToTenant: ReturnType<typeof vi.fn> };
}

const instance = { id: 'instance-1', tenantId: 'tenant-1', instanceName: 'inst-1' };
const GROUP_JID = '120363000000000000@g.us';

function createHarness(): Harness {
  const prisma = {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    conversationParticipant: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const realtime = { emitToTenant: vi.fn() };
  const service = new WhatsAppConversationSyncService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeService,
  );
  return { service, prisma, realtime };
}

describe('WhatsAppConversationSyncService chat metadata', () => {
  it('updates an existing group conversation without touching inbox state', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      groupName: 'Antigo',
      avatarUrl: null,
    });

    const changed = await service.syncChat(instance, {
      remoteJid: GROUP_JID,
      name: 'Grupo novo',
    });

    expect(changed).toBe(true);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: { groupName: 'Grupo novo' },
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'conversation.updated', {
      conversationId: 'conversation-1',
    });
  });

  it('never creates a conversation that does not exist yet', async () => {
    const { service, prisma, realtime } = createHarness();

    const changed = await service.syncChat(instance, { remoteJid: GROUP_JID, name: 'Grupo' });

    expect(changed).toBe(false);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('does not use an individual chat push name to overwrite the CRM contact name', async () => {
    const { service, prisma } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: false,
      groupName: null,
      avatarUrl: null,
    });

    const changed = await service.syncChat(instance, {
      remoteJid: '5511999999999@s.whatsapp.net',
      name: 'Push name',
    });

    expect(changed).toBe(false);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('ignores duplicate chat events without emitting realtime updates', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      groupName: 'Grupo novo',
      avatarUrl: 'https://cdn/avatar.jpg',
    });

    const changed = await service.syncChat(instance, {
      remoteJid: GROUP_JID,
      name: 'Grupo novo',
      avatar: 'https://cdn/avatar.jpg',
    });

    expect(changed).toBe(false);
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });
});

describe('WhatsAppConversationSyncService groups', () => {
  it('updates group name/avatar and replaces participants idempotently', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      groupName: 'Antigo',
      avatarUrl: null,
    });
    prisma.conversationParticipant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ jid: '5511888888888@s.whatsapp.net' }]);

    const changed = await service.syncGroup(
      instance,
      {
        id: GROUP_JID,
        subject: 'Grupo novo',
        participants: [
          {
            id: '5511888888888@s.whatsapp.net',
            name: 'Bruno',
            phoneNumber: '5511888888888',
            admin: 'admin',
          },
        ],
      },
      { replaceParticipants: true },
    );

    expect(changed).toBe(true);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: { groupName: 'Grupo novo' },
    });
    expect(prisma.conversationParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        jid: '5511888888888@s.whatsapp.net',
        phone: '5511888888888',
        name: 'Bruno',
        isAdmin: true,
        active: true,
      }),
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'conversation.updated', {
      conversationId: 'conversation-1',
    });
  });

  it('deactivates participants that are no longer in a full group snapshot', async () => {
    const { service, prisma } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      groupName: 'Grupo',
      avatarUrl: null,
    });
    prisma.conversationParticipant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { jid: '5511888888888@s.whatsapp.net' },
        { jid: '5511777777777@s.whatsapp.net' },
      ]);

    await service.syncGroup(
      instance,
      {
        id: GROUP_JID,
        participants: [{ id: '5511888888888@s.whatsapp.net' }],
      },
      { replaceParticipants: true },
    );

    expect(prisma.conversationParticipant.updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation-1',
        jid: { in: ['5511777777777@s.whatsapp.net'] },
      },
      data: { active: false, leftAt: expect.any(Date) },
    });
  });

  it('does not remove participants on a partial groups.update event', async () => {
    const { service, prisma } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      isGroup: true,
      groupName: 'Antigo',
      avatarUrl: null,
    });

    await service.syncGroup(
      instance,
      { id: GROUP_JID, subject: 'Novo' },
      { replaceParticipants: false },
    );

    expect(prisma.conversationParticipant.findMany).not.toHaveBeenCalled();
    expect(prisma.conversationParticipant.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the conversation scoped to the event instance and tenant', async () => {
    const { service, prisma } = createHarness();

    await service.syncGroup(instance, { id: GROUP_JID }, { replaceParticipants: true });

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          whatsappInstanceId: 'instance-1',
          externalContactId: GROUP_JID,
        },
      }),
    );
  });
});

describe('WhatsAppConversationSyncService group participants', () => {
  it('adds a participant idempotently', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1' });

    const changed = await service.syncGroupParticipants(instance, {
      id: GROUP_JID,
      action: 'add',
      participants: ['5511888888888@s.whatsapp.net'],
      participantsData: [
        {
          jid: '5511888888888@s.whatsapp.net',
          phoneNumber: '5511888888888',
          name: 'Bruno',
          imgUrl: 'https://cdn/b.jpg',
        },
      ],
    });

    expect(changed).toBe(true);
    expect(prisma.conversationParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        jid: '5511888888888@s.whatsapp.net',
        phone: '5511888888888',
        name: 'Bruno',
        avatarUrl: 'https://cdn/b.jpg',
      }),
    });
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'conversation.updated', {
      conversationId: 'conversation-1',
    });
  });

  it('does not repeat writes when the same participant event arrives again', async () => {
    const { service, prisma, realtime } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1' });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      {
        jid: '5511888888888@s.whatsapp.net',
        phone: '5511888888888',
        name: 'Bruno',
        avatarUrl: null,
        isAdmin: false,
        active: true,
      },
    ]);

    const changed = await service.syncGroupParticipants(instance, {
      id: GROUP_JID,
      action: 'add',
      participants: ['5511888888888@s.whatsapp.net'],
      participantsData: [{ jid: '5511888888888@s.whatsapp.net', name: 'Bruno' }],
    });

    expect(changed).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('marks a removed participant as inactive and preserves the row', async () => {
    const { service, prisma } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1' });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      { jid: '5511888888888@s.whatsapp.net' },
    ]);

    const changed = await service.syncGroupParticipants(instance, {
      id: GROUP_JID,
      action: 'remove',
      participants: ['5511888888888@s.whatsapp.net'],
    });

    expect(changed).toBe(true);
    expect(prisma.conversationParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1', jid: { in: ['5511888888888@s.whatsapp.net'] } },
      data: { active: false, leftAt: expect.any(Date) },
    });
    expect(prisma.conversationParticipant.create).not.toHaveBeenCalled();
  });

  it('promotes and demotes participants without duplicating rows', async () => {
    const { service, prisma } = createHarness();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1' });
    prisma.conversationParticipant.findMany.mockResolvedValue([
      {
        jid: '5511888888888@s.whatsapp.net',
        phone: '5511888888888',
        name: 'Bruno',
        avatarUrl: null,
        isAdmin: false,
        active: true,
      },
    ]);

    await service.syncGroupParticipants(instance, {
      id: GROUP_JID,
      action: 'promote',
      participants: ['5511888888888@s.whatsapp.net'],
    });

    expect(prisma.conversationParticipant.update).toHaveBeenCalledWith({
      where: {
        conversationId_jid: {
          conversationId: 'conversation-1',
          jid: '5511888888888@s.whatsapp.net',
        },
      },
      data: { isAdmin: true },
    });
    expect(prisma.conversationParticipant.create).not.toHaveBeenCalled();
  });

  it('ignores participant events for a group outside the tenant/instance', async () => {
    const { service, prisma, realtime } = createHarness();

    const changed = await service.syncGroupParticipants(instance, {
      id: GROUP_JID,
      action: 'add',
      participants: ['5511888888888@s.whatsapp.net'],
    });

    expect(changed).toBe(false);
    expect(prisma.conversationParticipant.findMany).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });
});
