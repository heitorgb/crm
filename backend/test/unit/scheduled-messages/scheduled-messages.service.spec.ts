import { ScheduledMessageRecipientStatus, ScheduledMessageStatus } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { StorageService } from '../../../src/infrastructure/storage/storage.types.js';
import type { MediaProcessingService } from '../../../src/infrastructure/media/media-processing.service.js';
import { ScheduledMessageInvalidWeekdaysError } from '../../../src/modules/scheduled-messages/scheduled-messages.errors.js';
import { ScheduledMessagesService } from '../../../src/modules/scheduled-messages/scheduled-messages.service.js';

const CONTEXT: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  membershipId: 'member-a',
  role: 'OWNER',
};

function storedSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-1',
    type: 'CAMPAIGN',
    title: 'Campanha',
    content: 'Olá, {nome}',
    valor: null,
    recurrence: 'DAILY',
    weekdays: [1, 3, 5],
    timeZone: 'America/Sao_Paulo',
    scheduledAt: new Date('2099-01-05T12:00:00.000Z'),
    nextRunAt: new Date('2099-01-05T12:00:00.000Z'),
    lastRunAt: null,
    recipientCount: 1,
    status: ScheduledMessageStatus.SCHEDULED,
    canceledAt: null,
    attachmentStorageKey: null,
    attachmentThumbnailKey: null,
    attachmentFileName: null,
    attachmentMimeType: null,
    attachmentSize: null,
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  };
}

function createHarness() {
  const tx = {
    scheduledMessage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    scheduledMessageRecipient: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };

  const prisma = {
    scheduledMessage: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    scheduledMessageRecipient: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    conversation: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'conversation-1',
          contactId: 'contact-1',
          externalContactId: '5511999999999@s.whatsapp.net',
          externalLid: null,
          preferredAddress: null,
          isGroup: false,
          groupName: null,
          whatsappInstanceId: 'instance-1',
          contact: { name: 'Ana', phone: '5511999999999' },
        },
      ]),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
  };

  const config = {
    get: vi.fn((key: string) => {
      if (key === 'SCHEDULED_MESSAGE_TIMEZONE') return 'America/Sao_Paulo';
      if (key === 'SCHEDULED_MESSAGE_MAX_RECIPIENTS') return 100;
      if (key === 'MEDIA_MAX_BYTES') return 5_000_000;
      return undefined;
    }),
  };

  const tenantContext = {
    requireContext: vi.fn(() => CONTEXT),
  };

  const service = new ScheduledMessagesService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    config as unknown as ConfigService<Env, true>,
    {
      isImage: vi.fn(),
      optimizeImage: vi.fn(),
      makeThumbnail: vi.fn(),
    } as unknown as MediaProcessingService,
    { get: vi.fn(), put: vi.fn(), delete: vi.fn(), exists: vi.fn() } as unknown as StorageService,
    { enqueue: vi.fn() } as unknown as JobQueue,
  );

  return { service, prisma, tx, tenantContext };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    createdByUserId: 'user-a',
    type: 'CAMPAIGN',
    title: 'Campanha',
    content: 'Olá, {nome}',
    valor: null,
    recurrence: 'DAILY',
    weekdays: [5, 1, 3],
    scheduledAt: '2099-01-05T09:00',
    conversationIds: ['conversation-1'],
    file: null,
    ...overrides,
  };
}

describe('ScheduledMessagesService weekdays', () => {
  it('rejects an empty weekday selection before persisting', async () => {
    const { service, prisma } = createHarness();

    await expect(service.create(createInput({ weekdays: [] }))).rejects.toBeInstanceOf(
      ScheduledMessageInvalidWeekdaysError,
    );

    expect(prisma.scheduledMessage.create).not.toHaveBeenCalled();
  });

  it('rejects invalid and duplicated weekdays before persisting', async () => {
    const { service, prisma } = createHarness();

    await expect(service.create(createInput({ weekdays: [1, 9] }))).rejects.toBeInstanceOf(
      ScheduledMessageInvalidWeekdaysError,
    );
    await expect(service.create(createInput({ weekdays: [1, 1] }))).rejects.toBeInstanceOf(
      ScheduledMessageInvalidWeekdaysError,
    );

    expect(prisma.scheduledMessage.create).not.toHaveBeenCalled();
  });

  it('persists the normalized selection for a daily schedule', async () => {
    const { service, prisma } = createHarness();
    prisma.scheduledMessage.create.mockImplementation(
      async ({ data }: { data: { weekdays: number[] } }) =>
        storedSchedule({ weekdays: data.weekdays }),
    );

    const result = await service.create(createInput());

    expect(prisma.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recurrence: 'DAILY', weekdays: [1, 3, 5] }),
      }),
    );
    expect(result.weekdays).toEqual([1, 3, 5]);
  });

  it('clears weekdays when the schedule does not use them', async () => {
    const { service, prisma } = createHarness();
    prisma.scheduledMessage.create.mockImplementation(
      async ({ data }: { data: { weekdays: number[] } }) =>
        storedSchedule({ recurrence: 'WEEKLY', weekdays: data.weekdays }),
    );

    const result = await service.create(createInput({ recurrence: 'WEEKLY', weekdays: 'invalid' }));

    expect(prisma.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recurrence: 'WEEKLY', weekdays: [] }),
      }),
    );
    expect(result.weekdays).toEqual([]);
  });
});

describe('ScheduledMessagesService cancel', () => {
  it('atomically finalizes the recurrence and skips pending/in-flight recipients', async () => {
    const { service, prisma, tx, tenantContext } = createHarness();
    prisma.scheduledMessage.findFirst.mockResolvedValueOnce(storedSchedule()).mockResolvedValueOnce(
      storedSchedule({
        status: ScheduledMessageStatus.CANCELED,
        canceledAt: new Date('2026-10-24T12:00:00.000Z'),
        nextRunAt: null,
      }),
    );

    const result = await service.cancel('schedule-1');

    expect(tenantContext.requireContext).toHaveBeenCalled();
    expect(prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'schedule-1', tenantId: 'tenant-a' } }),
    );
    expect(tx.scheduledMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'schedule-1',
        tenantId: 'tenant-a',
        status: { not: ScheduledMessageStatus.CANCELED },
      },
      data: {
        status: ScheduledMessageStatus.CANCELED,
        canceledAt: expect.any(Date),
        nextRunAt: null,
      },
    });
    expect(tx.scheduledMessageRecipient.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        scheduledMessageId: 'schedule-1',
        status: {
          in: [ScheduledMessageRecipientStatus.PENDING, ScheduledMessageRecipientStatus.PROCESSING],
        },
      },
      data: { status: ScheduledMessageRecipientStatus.SKIPPED },
    });
    expect(result.status).toBe(ScheduledMessageStatus.CANCELED);
  });

  it('is idempotent for a schedule that is already canceled', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.scheduledMessage.findFirst.mockResolvedValue(
      storedSchedule({ status: ScheduledMessageStatus.CANCELED }),
    );

    const result = await service.cancel('schedule-1');

    expect(result.status).toBe(ScheduledMessageStatus.CANCELED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.scheduledMessage.updateMany).not.toHaveBeenCalled();
  });
});
