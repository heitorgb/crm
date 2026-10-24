import { ScheduledMessageRecipientStatus, ScheduledMessageStatus } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { ConversationProcessingService } from '../../../src/modules/conversations/conversation-processing.service.js';
import { ScheduledMessageSenderService } from '../../../src/modules/scheduled-messages/scheduled-message-sender.service.js';

const SCHEDULED_FOR = new Date('2026-10-19T12:00:00.000Z');

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-1',
    tenantId: 'tenant-a',
    type: 'CAMPAIGN',
    title: 'Campanha',
    content: 'Olá, {nome}',
    valor: null,
    attachmentStorageKey: null,
    attachmentThumbnailKey: null,
    attachmentFileName: null,
    attachmentMimeType: null,
    attachmentSize: null,
    recurrence: 'DAILY',
    weekdays: [1, 3, 5],
    timeZone: 'America/Sao_Paulo',
    scheduledAt: SCHEDULED_FOR,
    nextRunAt: SCHEDULED_FOR,
    lastRunAt: null,
    recipientCount: 1,
    status: ScheduledMessageStatus.PROCESSING,
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function recipient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recipient-1',
    tenantId: 'tenant-a',
    scheduledMessageId: 'schedule-1',
    scheduledFor: SCHEDULED_FOR,
    recipientKey: 'conversation:conversation-1',
    conversationId: 'conversation-1',
    contactId: 'contact-1',
    recipientName: 'Ana',
    destination: '5511999999999',
    whatsappInstanceId: 'instance-1',
    status: ScheduledMessageRecipientStatus.SENT,
    attempts: 1,
    nextAttemptAt: null,
    externalMessageId: 'external-1',
    messageId: 'message-1',
    errorCode: null,
    errorMessage: null,
    processedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createHarness(scheduleOverrides: Record<string, unknown> = {}) {
  const tx = {
    scheduledMessage: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scheduledMessageRecipient: {
      findMany: vi.fn().mockResolvedValue([recipient()]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const prisma = {
    scheduledMessage: {
      findFirst: vi.fn().mockResolvedValue(schedule(scheduleOverrides)),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    scheduledMessageRecipient: {
      findMany: vi.fn().mockResolvedValue([recipient()]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Empresa' }),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
  };

  const config = {
    get: vi.fn((key: string) => {
      if (key === 'SCHEDULED_MESSAGE_MAX_ATTEMPTS') return 3;
      if (key === 'SCHEDULED_MESSAGE_INTERVAL_MS') return 0;
      return undefined;
    }),
  };

  const conversations = {
    sendStoredTextToConversation: vi.fn(),
    sendStoredMediaToConversation: vi.fn(),
  };

  const service = new ScheduledMessageSenderService(
    prisma as unknown as PrismaService,
    new TenantContextService(),
    config as unknown as ConfigService<Env, true>,
    conversations as unknown as ConversationProcessingService,
    { enqueue: vi.fn() } as unknown as JobQueue,
  );

  return { service, prisma, tx, conversations };
}

const payload = {
  tenantId: 'tenant-a',
  scheduleId: 'schedule-1',
  scheduledFor: SCHEDULED_FOR.toISOString(),
};

describe('ScheduledMessageSenderService', () => {
  it('does not process an old job after the schedule was canceled', async () => {
    const { service, prisma } = createHarness({ status: ScheduledMessageStatus.CANCELED });

    await service.processOccurrence(payload);

    expect(prisma.scheduledMessageRecipient.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not claim a recipient when the schedule is canceled during the send', async () => {
    const { service, prisma, tx, conversations } = createHarness({
      status: ScheduledMessageStatus.PROCESSING,
    });
    prisma.scheduledMessageRecipient.findMany.mockResolvedValue([
      recipient({ status: ScheduledMessageRecipientStatus.PENDING }),
    ]);
    tx.scheduledMessage.updateMany.mockResolvedValue({ count: 0 });

    await service.processOccurrence(payload);

    expect(prisma.scheduledMessageRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduledMessage: {
            is: { status: { not: ScheduledMessageStatus.CANCELED } },
          },
        }),
      }),
    );
    expect(conversations.sendStoredTextToConversation).not.toHaveBeenCalled();
    expect(prisma.scheduledMessageRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ScheduledMessageRecipientStatus.PROCESSING,
        }),
      }),
    );
  });

  it('does not clone the next occurrence when the schedule terminal state changed', async () => {
    const { service, tx } = createHarness({ status: ScheduledMessageStatus.PROCESSING });
    tx.scheduledMessage.updateMany.mockResolvedValue({ count: 0 });

    await service.processOccurrence(payload);

    expect(tx.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [ScheduledMessageStatus.SCHEDULED, ScheduledMessageStatus.PROCESSING],
          },
          nextRunAt: SCHEDULED_FOR,
        }),
      }),
    );
    expect(tx.scheduledMessageRecipient.createMany).not.toHaveBeenCalled();
    expect(tx.scheduledMessageRecipient.findMany).not.toHaveBeenCalled();
  });

  it('clones the next occurrence at the next selected weekday inside the transaction', async () => {
    const { service, tx } = createHarness();

    await service.processOccurrence(payload);

    expect(tx.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ScheduledMessageStatus.SCHEDULED,
          nextRunAt: new Date('2026-10-21T12:00:00.000Z'),
        }),
      }),
    );
    expect(tx.scheduledMessageRecipient.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          scheduledFor: new Date('2026-10-21T12:00:00.000Z'),
          status: ScheduledMessageRecipientStatus.PENDING,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('keeps the one-time completion conditional on a non-canceled status', async () => {
    const { service, prisma } = createHarness({
      recurrence: 'ONCE',
      weekdays: [],
      status: ScheduledMessageStatus.PROCESSING,
    });

    await service.processOccurrence(payload);

    expect(prisma.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'schedule-1',
          tenantId: 'tenant-a',
          status: { not: ScheduledMessageStatus.CANCELED },
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
