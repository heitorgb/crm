import { MessageStatus } from '@prisma/client';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { MessagesService } from '../../../src/modules/conversations/messages.service.js';

interface PrismaMock {
  message: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function createService(): { service: MessagesService; prisma: PrismaMock } {
  const prisma: PrismaMock = {
    message: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const tenantContext = {
    requireContext: () => ({
      tenantId: 'tenant-1',
      userId: 'user-1',
      membershipId: 'member-1',
      role: 'OWNER',
    }),
  } as unknown as TenantContextService;

  const service = new MessagesService(prisma as unknown as PrismaService, tenantContext, {} as never);

  return { service, prisma };
}

function seedMessage(prisma: PrismaMock, status: MessageStatus): void {
  prisma.message.findFirst.mockResolvedValue({
    id: 'message-1',
    conversationId: 'conversation-1',
    status,
  });
}

describe('MessagesService.searchInConversation', () => {
  it('searches text and transcriptions of the tenant conversation, skipping hidden and deleted messages', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'm-2', direction: 'INBOUND', type: 'AUDIO', content: null, senderName: 'Ana',
        occurredAt: new Date('2026-11-05T12:05:00Z'), transcription: { text: 'quero o pedido azul' } },
      { id: 'm-1', direction: 'OUTBOUND', type: 'TEXT', content: 'Pedido azul enviado', senderName: null,
        occurredAt: new Date('2026-11-05T12:00:00Z'), transcription: null },
    ]);
    const conversationFindFirst = vi.fn().mockResolvedValue({ id: 'conversation-1' });
    const prisma = { message: { findMany }, conversation: { findFirst: conversationFindFirst } };
    const tenantContext = {
      requireContext: () => ({ tenantId: 'tenant-1', userId: 'user-1', membershipId: 'member-1', role: 'OWNER' }),
    } as unknown as TenantContextService;
    const service = new MessagesService(prisma as unknown as PrismaService, tenantContext, {} as never);

    const results = await service.searchInConversation('conversation-1', 'azul');

    expect(conversationFindFirst).toHaveBeenCalledWith({
      where: { id: 'conversation-1', tenantId: 'tenant-1' }, select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        hiddenForUsers: { none: { userId: 'user-1' } },
        NOT: { metadata: { path: ['deletedForEveryone'], equals: true } },
        OR: [
          { content: { contains: 'azul', mode: 'insensitive' } },
          { transcription: { text: { contains: 'azul', mode: 'insensitive' } } },
        ],
      },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    }));
    expect(results.map((result) => [result.id, result.text])).toEqual([
      ['m-2', 'quero o pedido azul'],
      ['m-1', 'Pedido azul enviado'],
    ]);
  });

  it('rejects conversations outside the current tenant', async () => {
    const prisma = { message: { findMany: vi.fn() }, conversation: { findFirst: vi.fn().mockResolvedValue(null) } };
    const tenantContext = {
      requireContext: () => ({ tenantId: 'tenant-1', userId: 'user-1', membershipId: 'member-1', role: 'OWNER' }),
    } as unknown as TenantContextService;
    const service = new MessagesService(prisma as unknown as PrismaService, tenantContext, {} as never);

    await expect(service.searchInConversation('other-tenant-conversation', 'azul')).rejects.toThrow();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});

describe('MessagesService.updateOutboundStatusByExternalId', () => {
  it('turns a SENT message into FAILED when the provider reports ERROR', async () => {
    const { service, prisma } = createService();
    seedMessage(prisma, MessageStatus.SENT);

    const result = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.FAILED,
    });

    expect(prisma.message.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        externalMessageId: 'ext-1',
        direction: 'OUTBOUND',
      },
      select: { id: true, conversationId: true, status: true },
    });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'message-1' },
      data: { status: MessageStatus.FAILED },
    });
    expect(result).toEqual({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: MessageStatus.FAILED,
    });
  });

  it('turns a PENDING message into FAILED when the provider reports ERROR', async () => {
    const { service, prisma } = createService();
    seedMessage(prisma, MessageStatus.PENDING);

    const result = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.FAILED,
    });

    expect(result?.status).toBe(MessageStatus.FAILED);
    expect(prisma.message.update).toHaveBeenCalled();
  });

  it('never regresses DELIVERED into FAILED on a late ERROR', async () => {
    const { service, prisma } = createService();
    seedMessage(prisma, MessageStatus.DELIVERED);

    const result = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.FAILED,
    });

    expect(result).toBeNull();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('never regresses READ into FAILED', async () => {
    const { service, prisma } = createService();
    seedMessage(prisma, MessageStatus.READ);

    const result = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.FAILED,
    });

    expect(result).toBeNull();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('is idempotent for duplicate ERROR events on an already FAILED message', async () => {
    const { service, prisma } = createService();
    seedMessage(prisma, MessageStatus.FAILED);

    const result = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.FAILED,
    });

    expect(result).toBeNull();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('keeps FAILED terminal and never advances it to a success status', async () => {
    const { service, prisma } = createService();
    seedMessage(prisma, MessageStatus.FAILED);

    const result = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.READ,
    });

    expect(result).toBeNull();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('still advances SENT → DELIVERED → READ monotonically', async () => {
    const { service, prisma } = createService();
    seedMessage(prisma, MessageStatus.SENT);

    const delivered = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.DELIVERED,
    });
    expect(delivered?.status).toBe(MessageStatus.DELIVERED);

    seedMessage(prisma, MessageStatus.DELIVERED);
    const read = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'ext-1',
      status: MessageStatus.READ,
    });
    expect(read?.status).toBe(MessageStatus.READ);
  });

  it('returns null when the external id is unknown (foreign tenant included)', async () => {
    const { service, prisma } = createService();
    prisma.message.findFirst.mockResolvedValue(null);

    const result = await service.updateOutboundStatusByExternalId({
      tenantId: 'tenant-1',
      externalMessageId: 'missing',
      status: MessageStatus.FAILED,
    });

    expect(result).toBeNull();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });
});

describe('MessagesService.markOutboundFailed', () => {
  it('merges the error code without discarding existing metadata', async () => {
    const { service, prisma } = createService();
    prisma.message.findUnique.mockResolvedValue({
      metadata: { showAgentName: true, quoted: { externalId: 'quoted-1' } },
    });

    await service.markOutboundFailed('message-1', 'EVOLUTION_HTTP_500');

    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'message-1' },
      data: {
        status: MessageStatus.FAILED,
        metadata: expect.objectContaining({
          showAgentName: true,
          quoted: { externalId: 'quoted-1' },
          errorCode: 'EVOLUTION_HTTP_500',
          failedAt: expect.any(String),
        }),
      },
    });
  });
});
