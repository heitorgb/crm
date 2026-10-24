import { ScheduledMessageRecipientStatus, ScheduledMessageStatus } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.types.js';
import type { Env } from '../../../src/config/env.validation.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { StorageService } from '../../../src/infrastructure/storage/storage.types.js';
import type { MediaProcessingService } from '../../../src/infrastructure/media/media-processing.service.js';
import {
  ScheduledMessageInvalidDayOfMonthError,
  ScheduledMessageInvalidWeekdaysError,
} from '../../../src/modules/scheduled-messages/scheduled-messages.errors.js';
import { ScheduledMessagesService } from '../../../src/modules/scheduled-messages/scheduled-messages.service.js';

const CONTEXT: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  membershipId: 'member-a',
  role: 'OWNER',
};

const NOW = new Date('2026-10-19T13:00:00.000Z');

function storedSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-1',
    type: 'CAMPAIGN',
    title: 'Campanha',
    content: 'Olá, {nome}',
    valor: null,
    recurrence: 'DAILY',
    weekdays: [1, 3, 5],
    dayOfMonth: null,
    recurringTime: '09:00',
    timeZone: 'America/Sao_Paulo',
    scheduledAt: new Date('2026-10-19T12:00:00.000Z'),
    nextRunAt: new Date('2026-10-21T12:00:00.000Z'),
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
    scheduledMessage: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scheduledMessageRecipient: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
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
    recurringTime: '09:00',
    conversationIds: ['conversation-1'],
    file: null,
    ...overrides,
  };
}

function mockCreatedSchedule(prisma: ReturnType<typeof createHarness>['prisma']) {
  prisma.scheduledMessage.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) =>
      storedSchedule({
        recurrence: data.recurrence,
        weekdays: data.weekdays,
        dayOfMonth: data.dayOfMonth ?? null,
        recurringTime: data.recurringTime ?? null,
        scheduledAt: data.scheduledAt,
        nextRunAt: data.nextRunAt,
      }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ScheduledMessagesService recurring configuration', () => {
  it('rejects an empty weekday selection before persisting', async () => {
    const { service, prisma } = createHarness();

    await expect(service.create(createInput({ weekdays: [] }))).rejects.toBeInstanceOf(
      ScheduledMessageInvalidWeekdaysError,
    );

    expect(prisma.scheduledMessage.create).not.toHaveBeenCalled();
  });

  it('rejects a weekday-based recurrence without an explicit selection', async () => {
    const { service, prisma } = createHarness();

    await expect(service.create(createInput({ weekdays: undefined }))).rejects.toBeInstanceOf(
      ScheduledMessageInvalidWeekdaysError,
    );
    await expect(
      service.create(createInput({ recurrence: 'WEEKLY', weekdays: undefined })),
    ).rejects.toBeInstanceOf(ScheduledMessageInvalidWeekdaysError);

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

  it('persists daily weekdays and calculates the first selected occurrence', async () => {
    const { service, prisma } = createHarness();
    mockCreatedSchedule(prisma);

    const result = await service.create(createInput());

    expect(prisma.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrence: 'DAILY',
          weekdays: [1, 3, 5],
          dayOfMonth: null,
          recurringTime: '09:00',
          scheduledAt: new Date('2026-10-21T12:00:00.000Z'),
          nextRunAt: new Date('2026-10-21T12:00:00.000Z'),
        }),
      }),
    );
    expect(result.weekdays).toEqual([1, 3, 5]);
    expect(result.recurringTime).toBe('09:00');
  });

  it('persists weekly weekdays and respects every selected day', async () => {
    const { service, prisma } = createHarness();
    mockCreatedSchedule(prisma);

    const result = await service.create(
      createInput({ recurrence: 'WEEKLY', weekdays: [4, 1], recurringTime: '09:00' }),
    );

    expect(prisma.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrence: 'WEEKLY',
          weekdays: [1, 4],
          recurringTime: '09:00',
          scheduledAt: new Date('2026-10-22T12:00:00.000Z'),
        }),
      }),
    );
    expect(result.weekdays).toEqual([1, 4]);
  });

  it('persists the monthly day and ignores residual weekdays', async () => {
    const { service, prisma } = createHarness();
    mockCreatedSchedule(prisma);

    const result = await service.create(
      createInput({
        recurrence: 'MONTHLY',
        dayOfMonth: '31',
        weekdays: 'invalid',
        recurringTime: '09:00',
      }),
    );

    expect(prisma.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrence: 'MONTHLY',
          weekdays: [],
          dayOfMonth: 31,
          recurringTime: '09:00',
          scheduledAt: new Date('2026-10-31T12:00:00.000Z'),
        }),
      }),
    );
    expect(result.dayOfMonth).toBe(31);
    expect(result.weekdays).toEqual([]);
  });

  it('rejects an invalid or missing monthly day', async () => {
    const { service, prisma } = createHarness();

    for (const dayOfMonth of [undefined, '', 0, 32, 1.5]) {
      await expect(
        service.create(createInput({ recurrence: 'MONTHLY', dayOfMonth })),
      ).rejects.toBeInstanceOf(ScheduledMessageInvalidDayOfMonthError);
    }

    expect(prisma.scheduledMessage.create).not.toHaveBeenCalled();
  });

  it('keeps ONCE using the provided future date and clears recurring fields', async () => {
    const { service, prisma } = createHarness();
    mockCreatedSchedule(prisma);

    const result = await service.create(
      createInput({
        recurrence: 'ONCE',
        scheduledAt: '2099-01-05T09:00',
        weekdays: [1, 2],
        dayOfMonth: 31,
      }),
    );

    expect(prisma.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrence: 'ONCE',
          weekdays: [],
          dayOfMonth: null,
          recurringTime: null,
          scheduledAt: new Date('2099-01-05T12:00:00.000Z'),
          nextRunAt: new Date('2099-01-05T12:00:00.000Z'),
        }),
      }),
    );
    expect(result.recurringTime).toBeNull();
  });
});

describe('ScheduledMessagesService updates', () => {
  function mockCurrentAndUpdated(
    prisma: ReturnType<typeof createHarness>['prisma'],
    current: ReturnType<typeof storedSchedule>,
    updated: ReturnType<typeof storedSchedule>,
  ) {
    prisma.scheduledMessage.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(updated);
  }

  it('preserves the persisted configuration when timing did not change', async () => {
    const { service, prisma, tx } = createHarness();
    const current = storedSchedule();
    mockCurrentAndUpdated(prisma, current, current);

    await service.update('schedule-1', {
      title: 'Novo título',
      weekdays: [1, 3, 5],
      recurringTime: '09:00',
      conversationIds: ['conversation-1'],
      file: null,
    });

    expect(tx.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: expect.objectContaining({
        title: 'Novo título',
        recurrence: 'DAILY',
        weekdays: [1, 3, 5],
        recurringTime: '09:00',
        scheduledAt: current.scheduledAt,
        nextRunAt: current.nextRunAt,
      }),
    });
  });

  it('recalculates the next occurrence when weekdays change', async () => {
    const { service, prisma, tx } = createHarness();
    const current = storedSchedule();
    mockCurrentAndUpdated(prisma, current, storedSchedule());

    await service.update('schedule-1', {
      weekdays: [2],
      recurringTime: '09:00',
      conversationIds: ['conversation-1'],
      file: null,
    });

    expect(tx.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: expect.objectContaining({
        weekdays: [2],
        scheduledAt: new Date('2026-10-20T12:00:00.000Z'),
        nextRunAt: new Date('2026-10-20T12:00:00.000Z'),
      }),
    });
  });

  it('switches to monthly without sending residual weekdays', async () => {
    const { service, prisma, tx } = createHarness();
    const current = storedSchedule();
    mockCurrentAndUpdated(prisma, current, storedSchedule({ recurrence: 'MONTHLY' }));

    await service.update('schedule-1', {
      recurrence: 'MONTHLY',
      dayOfMonth: 31,
      recurringTime: '09:00',
      weekdays: [1, 3, 5],
      conversationIds: ['conversation-1'],
      file: null,
    });

    expect(tx.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: expect.objectContaining({
        recurrence: 'MONTHLY',
        weekdays: [],
        dayOfMonth: 31,
        recurringTime: '09:00',
        scheduledAt: new Date('2026-10-31T12:00:00.000Z'),
        nextRunAt: new Date('2026-10-31T12:00:00.000Z'),
      }),
    });
  });

  it('switches to ONCE and clears the recurring configuration', async () => {
    const { service, prisma, tx } = createHarness();
    const current = storedSchedule();
    mockCurrentAndUpdated(
      prisma,
      current,
      storedSchedule({ recurrence: 'ONCE', weekdays: [], recurringTime: null }),
    );

    await service.update('schedule-1', {
      recurrence: 'ONCE',
      scheduledAt: '2099-01-05T09:00',
      conversationIds: ['conversation-1'],
      file: null,
    });

    expect(tx.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: expect.objectContaining({
        recurrence: 'ONCE',
        weekdays: [],
        dayOfMonth: null,
        recurringTime: null,
        scheduledAt: new Date('2099-01-05T12:00:00.000Z'),
        nextRunAt: new Date('2099-01-05T12:00:00.000Z'),
      }),
    });
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
