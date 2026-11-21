import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import { ConversationNotFoundError } from '../../../src/modules/conversations/conversations.errors.js';
import { ConversationAccessGuard } from '../../../src/modules/store-access/conversation-access.guard.js';
import { StoreAccessService } from '../../../src/modules/store-access/store-access.service.js';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';

function createService(role = 'USER') {
  const prisma = {
    tenantUserStore: { findMany: vi.fn().mockResolvedValue([]) },
    conversation: { count: vi.fn() },
  };
  const tenantContext = {
    requireContext: () => ({ tenantId: 'tenant-1', userId: 'user-1', membershipId: 'member-1', role }),
  } as unknown as TenantContextService;
  const service = new StoreAccessService(
    prisma as unknown as PrismaService,
    tenantContext,
    new RealtimeService({} as PrismaService),
  );
  return { service, prisma };
}

describe('StoreAccessService', () => {
  it('keeps owners and admins unrestricted without reading store links', async () => {
    for (const role of ['OWNER', 'ADMIN', 'SYSTEM']) {
      const { service, prisma } = createService(role);
      await expect(service.current()).resolves.toEqual({ restricted: false });
      expect(prisma.tenantUserStore.findMany).not.toHaveBeenCalled();
    }
  });

  it('keeps members without linked stores unrestricted', async () => {
    const { service } = createService();
    await expect(service.current()).resolves.toEqual({ restricted: false });
  });

  it('restricts linked members to their stores and the stores WhatsApp instances', async () => {
    const { service, prisma } = createService();
    prisma.tenantUserStore.findMany.mockResolvedValue([
      { storeId: 'store-1', store: { whatsappInstanceId: 'instance-1' } },
      { storeId: 'store-2', store: { whatsappInstanceId: null } },
      { storeId: 'store-3', store: { whatsappInstanceId: 'instance-1' } },
    ]);

    const scope = await service.current();

    expect(prisma.tenantUserStore.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', tenantUserId: 'member-1' },
    }));
    expect(scope).toEqual({ restricted: true, storeIds: ['store-1', 'store-2', 'store-3'], instanceIds: ['instance-1'] });
    expect(service.conversationFilter(scope)).toEqual({ whatsappInstanceId: { in: ['instance-1'] } });
    expect(service.storeOrderFilter(scope)).toEqual({ storeId: { in: ['store-1', 'store-2', 'store-3'] } });
    expect(service.canAccessInstance(scope, 'instance-2')).toBe(false);
  });

  it('answers not found for conversations outside the member stores', async () => {
    const { service, prisma } = createService();
    prisma.tenantUserStore.findMany.mockResolvedValue([{ storeId: 'store-1', store: { whatsappInstanceId: 'instance-1' } }]);
    prisma.conversation.count.mockResolvedValue(1);

    await expect(service.assertConversations(['c-1', 'c-2', 'c-1'])).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(prisma.conversation.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', id: { in: ['c-1', 'c-2'] }, whatsappInstanceId: { in: ['instance-1'] } },
    });

    prisma.conversation.count.mockResolvedValue(2);
    await expect(service.assertConversations(['c-1', 'c-2'])).resolves.toBeUndefined();
  });

  it('skips the conversation lookup for unrestricted members', async () => {
    const { service, prisma } = createService('ADMIN');
    await service.assertConversations(['c-1']);
    expect(prisma.conversation.count).not.toHaveBeenCalled();
  });
});

describe('ConversationAccessGuard', () => {
  function context(params: Record<string, string>) {
    return { switchToHttp: () => ({ getRequest: () => ({ params }) }) } as never;
  }

  it('checks the conversation named by :id or :conversationId', async () => {
    const access = { assertConversations: vi.fn().mockResolvedValue(undefined) };
    const guard = new ConversationAccessGuard(access as unknown as StoreAccessService);

    await expect(guard.canActivate(context({ id: CONVERSATION_ID }))).resolves.toBe(true);
    await guard.canActivate(context({ conversationId: CONVERSATION_ID, messageId: 'x' }));

    expect(access.assertConversations).toHaveBeenNthCalledWith(1, [CONVERSATION_ID]);
    expect(access.assertConversations).toHaveBeenNthCalledWith(2, [CONVERSATION_ID]);
  });

  it('leaves routes without a conversation id to their own validation', async () => {
    const access = { assertConversations: vi.fn() };
    const guard = new ConversationAccessGuard(access as unknown as StoreAccessService);

    await guard.canActivate(context({}));
    await guard.canActivate(context({ id: 'unread-count' }));

    expect(access.assertConversations).not.toHaveBeenCalled();
  });

  it('propagates the not-found answer', async () => {
    const access = { assertConversations: vi.fn().mockRejectedValue(new ConversationNotFoundError()) };
    const guard = new ConversationAccessGuard(access as unknown as StoreAccessService);

    await expect(guard.canActivate(context({ id: CONVERSATION_ID }))).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});

describe('RealtimeService conversation rooms', () => {
  it('sends conversation events to unrestricted members and to the instance room only', () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const realtime = new RealtimeService({} as PrismaService);
    realtime.attach({ to } as never);

    realtime.emitConversationEvent('tenant-1', 'instance-1', 'message.created', { conversationId: 'c-1' });

    expect(to).toHaveBeenCalledWith(['tenant:tenant-1:conversations', 'tenant:tenant-1:instance:instance-1']);
    expect(emit).toHaveBeenCalledWith('message.created', { conversationId: 'c-1' });
    expect(realtime.conversationRooms('tenant-1', ['instance-1', 'instance-2'])).toEqual([
      'tenant:tenant-1:instance:instance-1',
      'tenant:tenant-1:instance:instance-2',
    ]);
    expect(realtime.conversationRooms('tenant-1', 'all')).toEqual(['tenant:tenant-1:conversations']);
  });

  it('swaps only the conversation rooms of a member connected sockets', async () => {
    const socket = {
      rooms: new Set(['tenant:tenant-1', 'tenant:tenant-1:user:user-1', 'tenant:tenant-1:conversations', 'tenant:tenant-1:instance:old']),
      leave: vi.fn(),
      join: vi.fn(),
    };
    const fetchSockets = vi.fn().mockResolvedValue([socket]);
    const inRoom = vi.fn(() => ({ fetchSockets }));
    const realtime = new RealtimeService({} as PrismaService);
    realtime.attach({ in: inRoom } as never);

    await realtime.replaceConversationRooms('tenant-1', 'user-1', ['tenant:tenant-1:instance:new']);

    expect(inRoom).toHaveBeenCalledWith('tenant:tenant-1:user:user-1');
    expect(socket.leave.mock.calls.map(([room]) => room)).toEqual([
      'tenant:tenant-1:conversations',
      'tenant:tenant-1:instance:old',
    ]);
    expect(socket.join).toHaveBeenCalledWith(['tenant:tenant-1:instance:new']);
  });
});
