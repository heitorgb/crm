import { MessageStatus, StoreOrderStatus } from '@prisma/client';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import type { ConversationsService } from '../../../src/modules/conversations/conversations.service.js';
import type { ConversationProcessingService } from '../../../src/modules/conversations/conversation-processing.service.js';
import type { ModulesService } from '../../../src/modules/modules/modules.service.js';
import type { StoreAccessService } from '../../../src/modules/store-access/store-access.service.js';
import { StoreOrdersService } from '../../../src/modules/store-orders/store-orders.service.js';
import { ContactPhoneRequiredError, WhatsAppInstanceNotConnectedError } from '../../../src/modules/conversations/conversations.errors.js';

function harness(status: StoreOrderStatus = StoreOrderStatus.SEPARADO) {
  const order = {
    id: 'order-1', tenantId: 'tenant-1', status, contactId: null as string | null,
    store: { whatsappInstanceId: 'instance-1' as string | null, deliveryConfirmationMode: 'AUTOMATIC' },
  };
  const tx = {
    storeOrder: {
      findFirst: vi.fn().mockImplementation(async () => ({ ...order })),
      updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status?: StoreOrderStatus; contactId?: string } }) => {
        if (data.contactId) order.contactId = data.contactId;
        if (data.status) order.status = data.status;
        return { count: 1 };
      }),
      findFirstOrThrow: vi.fn().mockImplementation(async () => ({
        ...order, store: { id: 'store-1', name: 'Loja', logoUpdatedAt: null },
        contact: order.contactId ? { id: order.contactId, name: 'Ana', address: null } : null,
      })),
    },
    contact: { findFirst: vi.fn().mockResolvedValue({ id: 'contact-1', name: 'Ana' }) },
    storeOrderStatusChange: { create: vi.fn().mockResolvedValue({ id: 'change-1' }) },
  };
  const prisma = { $transaction: vi.fn().mockImplementation((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
  const tenantContext = {
    requireContext: () => ({ tenantId: 'tenant-1', membershipId: 'member-1', userId: 'user-1', role: 'OWNER' }),
  };
  const realtime = { emitToTenant: vi.fn() };
  const modules = { isEnabled: vi.fn().mockResolvedValue(true), isAllowedForMember: vi.fn().mockResolvedValue(true) };
  const conversations = { startFromContact: vi.fn().mockResolvedValue({ id: 'conversation-1' }) };
  const processing = { sendStoredTextToConversation: vi.fn().mockResolvedValue({ messageId: 'message-1', status: MessageStatus.SENT }) };
  const storeAccess = {
    current: vi.fn().mockResolvedValue({ restricted: true, storeIds: ['store-1'], instanceIds: ['instance-1'] }),
    storeOrderFilter: vi.fn().mockReturnValue({ storeId: { in: ['store-1'] } }),
    contactFilter: vi.fn().mockReturnValue({ stores: { some: { storeId: { in: ['store-1'] } } } }),
  };
  const service = new StoreOrdersService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    realtime as unknown as RealtimeService,
    modules as unknown as ModulesService,
    {} as never, {} as never, {} as never,
    conversations as unknown as ConversationsService,
    processing as unknown as ConversationProcessingService,
    storeAccess as unknown as StoreAccessService,
  );
  return { service, order, tx, modules, conversations, processing, realtime };
}

describe('StoreOrdersService.updateContact', () => {
  it.each([
    [StoreOrderStatus.SEPARADO, 'Seu pedido está separado e pronto para envio!'],
    [StoreOrderStatus.EM_ROTA, 'Seu pedido saiu para entrega!'],
  ])('sends only the current %s status using the store WhatsApp', async (status, text) => {
    const { service, processing, conversations, tx, realtime } = harness(status);
    const result = await service.updateContact('order-1', 'contact-1');

    expect(result.contactNotification.status).toBe('SENT');
    expect(conversations.startFromContact).toHaveBeenCalledExactlyOnceWith({
      contactId: 'contact-1', whatsappInstanceId: 'instance-1',
    });
    expect(processing.sendStoredTextToConversation).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1', conversationId: 'conversation-1', text: expect.stringContaining(text),
      metadata: { storeOrderId: 'order-1', storeOrderStatus: status },
    });
    expect(tx.storeOrder.updateMany.mock.invocationCallOrder[0]).toBeLessThan(processing.sendStoredTextToConversation.mock.invocationCallOrder[0]);
    expect(realtime.emitToTenant).toHaveBeenCalledWith('tenant-1', 'store-order.updated', { orderId: 'order-1' });
  });

  it.each([StoreOrderStatus.PENDENTE_SEPARACAO, StoreOrderStatus.SEPARANDO, StoreOrderStatus.OBSERVACAO, StoreOrderStatus.ENTREGUE])(
    'saves the contact without sending a message in %s', async (status) => {
      const { service, processing, tx } = harness(status);
      const result = await service.updateContact('order-1', 'contact-1');
      expect(result.contactId).toBe('contact-1');
      expect(result.contactNotification.status).toBe('SKIPPED');
      expect(tx.storeOrder.updateMany).toHaveBeenCalledOnce();
      expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
    },
  );

  it('does not send again when the same contact link is repeated', async () => {
    const { service, processing, tx } = harness();
    await service.updateContact('order-1', 'contact-1');
    const repeated = await service.updateContact('order-1', 'contact-1');
    expect(repeated.contactNotification.status).toBe('SKIPPED');
    expect(tx.storeOrder.updateMany).toHaveBeenCalledOnce();
    expect(processing.sendStoredTextToConversation).toHaveBeenCalledOnce();
  });

  it('rejects a concurrent contact or status change before sending', async () => {
    const { service, processing, tx } = harness();
    tx.storeOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateContact('order-1', 'contact-1')).rejects.toMatchObject({ code: 'ORDER_CONTACT_CONFLICT' });
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });

  it('scopes the order and contact by tenant and authorized stores', async () => {
    const { service, tx } = harness();
    await service.updateContact('order-1', 'contact-1');
    expect(tx.storeOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1', tenantId: 'tenant-1', AND: [{ storeId: { in: ['store-1'] } }] },
    }));
    expect(tx.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'contact-1', tenantId: 'tenant-1', AND: [{ stores: { some: { storeId: { in: ['store-1'] } } } }] },
    }));
    expect(tx.storeOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', tenantId: 'tenant-1', contactId: null, status: 'SEPARADO' },
      data: { contactId: 'contact-1', customerName: 'Ana' },
    });
  });

  it.each(['order', 'contact'])('does not save or send for an inaccessible %s', async (entity) => {
    const { service, tx, processing } = harness();
    if (entity === 'order') tx.storeOrder.findFirst.mockResolvedValue(null);
    else tx.contact.findFirst.mockResolvedValue(null);
    await expect(service.updateContact('order-1', 'contact-1')).rejects.toMatchObject({
      code: entity === 'order' ? 'ORDER_NOT_FOUND' : 'CONTACT_NOT_FOUND',
    });
    expect(tx.storeOrder.updateMany).not.toHaveBeenCalled();
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });

  it('preserves the saved link and reports a missing store WhatsApp', async () => {
    const { service, order, processing } = harness();
    order.store.whatsappInstanceId = null;
    const result = await service.updateContact('order-1', 'contact-1');
    expect(result.contactId).toBe('contact-1');
    expect(result.contactNotification).toMatchObject({ status: 'FAILED', message: expect.stringContaining('Configurações > Lojas') });
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });

  it.each(['organization', 'member'])('does not send when attendance is disabled for the %s', async (scope) => {
    const { service, modules, processing } = harness();
    if (scope === 'organization') modules.isEnabled.mockResolvedValue(false);
    else modules.isAllowedForMember.mockResolvedValue(false);
    const result = await service.updateContact('order-1', 'contact-1');
    expect(result.contactId).toBe('contact-1');
    expect(result.contactNotification.status).toBe('FAILED');
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });

  it('reports a provider failure while preserving the contact link', async () => {
    const { service, processing } = harness();
    processing.sendStoredTextToConversation.mockResolvedValue({ messageId: 'message-1', status: MessageStatus.FAILED, errorCode: 'EVOLUTION_SEND_FAILED' });
    const result = await service.updateContact('order-1', 'contact-1');
    expect(result.contactId).toBe('contact-1');
    expect(result.contactNotification.status).toBe('FAILED');
  });

  it('reports a connection error without returning its internal details', async () => {
    const { service, conversations } = harness();
    conversations.startFromContact.mockRejectedValue(new Error('private provider details'));
    const result = await service.updateContact('order-1', 'contact-1');
    expect(result.contactId).toBe('contact-1');
    expect(result.contactNotification.status).toBe('FAILED');
    expect(result.contactNotification.message).not.toContain('private provider details');
  });
});

describe('StoreOrdersService.updateStatus notifications', () => {
  it.each([
    [StoreOrderStatus.SEPARANDO, StoreOrderStatus.SEPARADO, 'separado e pronto'],
    [StoreOrderStatus.SEPARADO, StoreOrderStatus.EM_ROTA, 'saiu para entrega'],
  ])('sends the %s to %s transition through the store WhatsApp', async (previous, status, text) => {
    const { service, order, processing, conversations, tx } = harness(previous);
    order.contactId = 'contact-1';
    const result = await service.updateStatus('order-1', status);
    expect(result).toMatchObject({ status, contact: { id: 'contact-1' }, statusNotification: { status: 'SENT' } });
    expect(conversations.startFromContact).toHaveBeenCalledExactlyOnceWith({ contactId: 'contact-1', whatsappInstanceId: 'instance-1' });
    expect(processing.sendStoredTextToConversation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', text: expect.stringContaining(text), metadata: { storeOrderId: 'order-1', storeOrderStatus: status },
    }));
    expect(tx.storeOrderStatusChange.create).toHaveBeenCalledWith({ data: {
      tenantId: 'tenant-1', orderId: 'order-1', previousStatus: previous, status,
      actorMembershipId: 'member-1', origin: 'CRM_USER',
    } });
    expect(tx.storeOrderStatusChange.create.mock.invocationCallOrder[0]).toBeLessThan(processing.sendStoredTextToConversation.mock.invocationCallOrder[0]);
    await expect(service.updateStatus('order-1', status)).rejects.toMatchObject({ code: 'ORDER_STATUS_INVALID' });
    expect(processing.sendStoredTextToConversation).toHaveBeenCalledOnce();
  });

  it('waits for the sending outcome before returning the status update', async () => {
    const { service, order, processing } = harness(StoreOrderStatus.SEPARANDO);
    order.contactId = 'contact-1';
    let finishSend!: (value: { messageId: string; status: MessageStatus }) => void;
    processing.sendStoredTextToConversation.mockReturnValue(new Promise((resolve) => { finishSend = resolve; }));
    let returned = false;
    const pending = service.updateStatus('order-1', StoreOrderStatus.SEPARADO).then((result) => { returned = true; return result; });
    await vi.waitFor(() => expect(processing.sendStoredTextToConversation).toHaveBeenCalledOnce());
    expect(order.status).toBe('SEPARADO');
    expect(returned).toBe(false);
    finishSend({ messageId: 'message-1', status: MessageStatus.SENT });
    expect((await pending).statusNotification.status).toBe('SENT');
  });

  it('reports a missing store WhatsApp and preserves the new order status', async () => {
    const { service, order, processing, tx } = harness(StoreOrderStatus.SEPARANDO);
    order.contactId = 'contact-1';
    order.store.whatsappInstanceId = null;
    const result = await service.updateStatus('order-1', StoreOrderStatus.SEPARADO);
    expect(result).toMatchObject({ status: 'SEPARADO', statusNotification: { status: 'FAILED', message: expect.stringContaining('Configurações > Lojas') } });
    expect(tx.storeOrderStatusChange.create).toHaveBeenCalledOnce();
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });

  it('reports a missing contact instead of silently skipping the notification', async () => {
    const { service, processing } = harness(StoreOrderStatus.SEPARANDO);
    const result = await service.updateStatus('order-1', StoreOrderStatus.SEPARADO);
    expect(result).toMatchObject({ status: 'SEPARADO', statusNotification: { status: 'FAILED', message: expect.stringContaining('vincule um contato') } });
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });

  it.each([
    [new ContactPhoneRequiredError(), 'telefone cadastrado'],
    [new WhatsAppInstanceNotConnectedError(), 'desconectado'],
  ])('returns a clear sending precondition error without undoing the status', async (error, message) => {
    const { service, order, conversations } = harness(StoreOrderStatus.SEPARANDO);
    order.contactId = 'contact-1';
    conversations.startFromContact.mockRejectedValue(error);
    const result = await service.updateStatus('order-1', StoreOrderStatus.SEPARADO);
    expect(result).toMatchObject({ status: 'SEPARADO', statusNotification: { status: 'FAILED', message: expect.stringContaining(message) } });
  });

  it('returns the provider failure without reporting a successful send', async () => {
    const { service, order, processing } = harness(StoreOrderStatus.SEPARANDO);
    order.contactId = 'contact-1';
    processing.sendStoredTextToConversation.mockResolvedValue({ messageId: 'message-1', status: MessageStatus.FAILED });
    const result = await service.updateStatus('order-1', StoreOrderStatus.SEPARADO);
    expect(result).toMatchObject({ status: 'SEPARADO', statusNotification: { status: 'FAILED' } });
  });

  it('does not send for the separating status', async () => {
    const { service, order, processing } = harness(StoreOrderStatus.PENDENTE_SEPARACAO);
    order.contactId = 'contact-1';
    const result = await service.updateStatus('order-1', StoreOrderStatus.SEPARANDO);
    expect(result.statusNotification.status).toBe('SKIPPED');
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });

  it('does not send when the order is inaccessible or a concurrent status change wins', async () => {
    const { service, order, tx, processing } = harness(StoreOrderStatus.SEPARANDO);
    order.contactId = 'contact-1';
    tx.storeOrder.findFirst.mockResolvedValueOnce(null);
    await expect(service.updateStatus('order-1', StoreOrderStatus.SEPARADO)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    tx.storeOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.updateStatus('order-1', StoreOrderStatus.SEPARADO)).rejects.toMatchObject({ code: 'ORDER_STATUS_CONFLICT' });
    expect(tx.storeOrderStatusChange.create).not.toHaveBeenCalled();
    expect(processing.sendStoredTextToConversation).not.toHaveBeenCalled();
  });
});
