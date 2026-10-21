import { MessageDirection, MessageType, TranscriptionStatus } from '@prisma/client';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import type { StorageService } from '../../../src/infrastructure/storage/storage.types.js';
import type { ConversationProcessingService } from '../../../src/modules/conversations/conversation-processing.service.js';
import { AudioConversionFailure } from '../../../src/modules/transcription/audio-conversion.service.js';
import { TranscriptionDisabledError } from '../../../src/modules/transcription/transcription.errors.js';
import { TranscriptionProviderFailure } from '../../../src/modules/transcription/transcription.provider.js';
import { TranscriptionService } from '../../../src/modules/transcription/transcription.service.js';
import type { TranscriptionSettingsService } from '../../../src/modules/transcription/transcription-settings.service.js';

interface Harness {
  service: TranscriptionService;
  prisma: {
    message: { findFirst: ReturnType<typeof vi.fn> };
    messageAttachment: { findFirst: ReturnType<typeof vi.fn> };
    messageTranscription: {
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  settings: {
    getForExecution: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  adapter: { transcribe: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> };
  conversion: { prepare: ReturnType<typeof vi.fn> };
  conversations: { ensureMediaStored: ReturnType<typeof vi.fn> };
  storage: { get: ReturnType<typeof vi.fn> };
  queue: { enqueue: ReturnType<typeof vi.fn>; registerProcessor: ReturnType<typeof vi.fn> };
  realtime: { emitToConversation: ReturnType<typeof vi.fn>; emitToTenant: ReturnType<typeof vi.fn> };
}

function createHarness(overrides: Record<string, unknown> = {}): Harness {
  const prisma = {
    message: { findFirst: vi.fn() },
    messageAttachment: { findFirst: vi.fn() },
    messageTranscription: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const settings = {
    getForExecution: vi.fn().mockResolvedValue({
      provider: 'OPENAI',
      model: 'whisper-1',
      apiKey: 'sk-secret',
    }),
    resolveForTest: vi.fn(),
    get: vi.fn().mockResolvedValue({ available: true }),
  };
  const adapter = {
    transcribe: vi.fn().mockResolvedValue({
      text: 'Quero saber o preço.',
      language: 'pt',
      provider: 'OPENAI',
      model: 'whisper-1',
    }),
    check: vi.fn(),
  };
  const conversion = {
    prepare: vi.fn(async (input: { audio: Buffer; mimeType: string; fileName: string }) => ({
      ...input,
      converted: false,
    })),
  };
  const conversations = { ensureMediaStored: vi.fn().mockResolvedValue('stored') };
  const storage = { get: vi.fn().mockResolvedValue(Buffer.from('audio-bytes')) };
  const queue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    registerProcessor: vi.fn(),
  };
  const realtime = { emitToConversation: vi.fn(), emitToTenant: vi.fn() };
  const configValues: Record<string, unknown> = {
    TRANSCRIPTION_CONCURRENCY: 2,
    TRANSCRIPTION_TENANT_CONCURRENCY: 1,
    TRANSCRIPTION_MAX_ATTEMPTS: 2,
    TRANSCRIPTION_RETRY_DELAY_MS: 0,
    TRANSCRIPTION_MAX_BYTES: 1024,
    TRANSCRIPTION_MAX_DURATION_SECONDS: 600,
    TRANSCRIPTION_LANGUAGE: undefined,
    ...overrides,
  };
  const tenantContext = {
    run: <T>(_options: unknown, fn: () => Promise<T>) => fn(),
    requireContext: () => ({
      tenantId: 'tenant-1',
      userId: 'user-1',
      membershipId: 'membership-1',
      role: 'OWNER',
    }),
  } as unknown as TenantContextService;

  const service = new TranscriptionService(
    prisma as unknown as PrismaService,
    tenantContext,
    settings as unknown as TranscriptionSettingsService,
    { get: vi.fn(() => adapter) } as never,
    conversion as never,
    conversations as unknown as ConversationProcessingService,
    realtime as unknown as RealtimeService,
    { get: vi.fn((key: string) => configValues[key]) } as never,
    storage as unknown as StorageService,
    queue as unknown as JobQueue,
  );

  return {
    service,
    prisma,
    settings,
    adapter,
    conversion,
    conversations,
    storage,
    queue,
    realtime,
  };
}

function seedMessage(
  prisma: Harness['prisma'],
  overrides: {
    type?: MessageType;
    direction?: MessageDirection;
    transcription?: unknown;
    attachments?: Array<{ storageKey: string; fileName: string; mimeType: string; size: number }>;
    metadata?: Record<string, unknown>;
  } = {},
): void {
  prisma.message.findFirst.mockResolvedValue({
    id: 'message-1',
    conversationId: 'conversation-1',
    type: overrides.type ?? MessageType.AUDIO,
    direction: overrides.direction ?? MessageDirection.INBOUND,
    metadata: overrides.metadata ?? {},
    transcription: overrides.transcription ?? null,
    attachments:
      overrides.attachments ??
      [
        {
          storageKey: 'tenant/tenant-1/messages/message-1/audio.ogg',
          fileName: 'audio.ogg',
          mimeType: 'audio/ogg',
          size: 11,
        },
      ],
  });
}

function lastTranscriptionUpsert(prisma: Harness['prisma']) {
  return prisma.messageTranscription.upsert.mock.calls.at(-1)?.[0] as
    | { create: Record<string, unknown>; update: Record<string, unknown> }
    | undefined;
}

describe('TranscriptionService', () => {
  it('transcribes an eligible inbound audio and emits a message update', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma);

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-1',
        apiKey: 'sk-secret',
        mimeType: 'audio/ogg',
        fileName: 'audio.ogg',
      }),
    );
    expect(harness.prisma.messageTranscription.update).toHaveBeenLastCalledWith({
      where: { messageId: 'message-1' },
      data: expect.objectContaining({
        status: TranscriptionStatus.COMPLETED,
        text: 'Quero saber o preço.',
        language: 'pt',
        provider: 'OPENAI',
        model: 'whisper-1',
      }),
    });
    expect(harness.realtime.emitToConversation).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      'message.updated',
      { conversationId: 'conversation-1', messageId: 'message-1' },
    );
  });

  it('uses the exact provider and model saved for the tenant', async () => {
    const harness = createHarness();
    harness.settings.getForExecution.mockResolvedValue({
      provider: 'OPENAI',
      model: 'gpt-4o-transcribe',
      apiKey: 'sk-tenant-model',
    });
    seedMessage(harness.prisma);

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-transcribe', apiKey: 'sk-tenant-model' }),
    );
  });

  it('fails with a clear conversion error instead of blaming the model', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma);
    harness.conversion.prepare.mockRejectedValue(new AudioConversionFailure('conversion_failed'));

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
    expect(lastTranscriptionUpsert(harness.prisma)?.update).toMatchObject({
      status: TranscriptionStatus.FAILED,
      provider: 'OPENAI',
      model: 'whisper-1',
      errorCode: 'AI_TRANSCRIPTION_CONVERSION_FAILED',
    });
  });

  it('marks the message as not applicable when transcription is disabled', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma);
    harness.settings.getForExecution.mockRejectedValue(new TranscriptionDisabledError());

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
    expect(lastTranscriptionUpsert(harness.prisma)?.update).toMatchObject({
      status: TranscriptionStatus.NOT_APPLICABLE,
      errorCode: 'AI_TRANSCRIPTION_DISABLED',
    });
  });

  it('does not process non-audio or outbound messages', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma, { type: MessageType.TEXT });

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
    expect(lastTranscriptionUpsert(harness.prisma)?.create).toMatchObject({
      status: TranscriptionStatus.NOT_APPLICABLE,
    });
  });

  it('never transcribes the same message twice when it is already completed', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma, {
      transcription: {
        id: 'transcription-1',
        status: TranscriptionStatus.COMPLETED,
        text: 'já transcrito',
        updatedAt: new Date(),
      },
    });

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.settings.getForExecution).not.toHaveBeenCalled();
    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
  });

  it('does not call the provider when another worker already claimed the row', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma);
    harness.prisma.messageTranscription.updateMany.mockResolvedValue({ count: 0 });

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
  });

  it('retries a transient provider failure up to the configured limit', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma);
    harness.adapter.transcribe.mockRejectedValue(new TranscriptionProviderFailure('rate_limit'));

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).toHaveBeenCalledTimes(2);
    expect(lastTranscriptionUpsert(harness.prisma)?.update).toMatchObject({
      status: TranscriptionStatus.FAILED,
      retryable: true,
      errorCode: 'AI_TRANSCRIPTION_RATE_LIMITED',
    });
  });

  it('does not retry a permanent authentication failure', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma);
    harness.adapter.transcribe.mockRejectedValue(new TranscriptionProviderFailure('auth'));

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).toHaveBeenCalledTimes(1);
    expect(lastTranscriptionUpsert(harness.prisma)?.update).toMatchObject({
      status: TranscriptionStatus.FAILED,
      retryable: false,
      errorCode: 'AI_TRANSCRIPTION_AUTH_FAILED',
    });
    expect(harness.realtime.emitToConversation).toHaveBeenCalledWith(
      'tenant-1',
      'conversation-1',
      'message.updated',
      { conversationId: 'conversation-1', messageId: 'message-1' },
    );
  });

  it('rejects an oversized audio before calling the provider', async () => {
    const harness = createHarness({ TRANSCRIPTION_MAX_BYTES: 10 });
    seedMessage(harness.prisma);

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
    expect(lastTranscriptionUpsert(harness.prisma)?.update).toMatchObject({
      errorCode: 'AI_TRANSCRIPTION_FILE_TOO_LARGE',
      retryable: false,
    });
  });

  it('rejects audio above the maximum duration reported by WhatsApp', async () => {
    const harness = createHarness({ TRANSCRIPTION_MAX_DURATION_SECONDS: 30 });
    seedMessage(harness.prisma, { metadata: { audioDurationSeconds: 120 } });

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
    expect(lastTranscriptionUpsert(harness.prisma)?.update).toMatchObject({
      errorCode: 'AI_TRANSCRIPTION_AUDIO_TOO_LONG',
      retryable: false,
    });
  });

  it('downloads media on demand when the attachment is still missing', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma, { attachments: [] });
    harness.prisma.messageAttachment.findFirst.mockResolvedValue({
      storageKey: 'tenant/tenant-1/messages/message-1/audio.ogg',
      fileName: 'audio.ogg',
      mimeType: 'audio/ogg',
      size: 11,
    });

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.conversations.ensureMediaStored).toHaveBeenCalledWith('tenant-1', 'message-1');
    expect(harness.adapter.transcribe).toHaveBeenCalledTimes(1);
  });

  it('marks a missing media file as a recoverable failure', async () => {
    const harness = createHarness();
    seedMessage(harness.prisma, { attachments: [] });
    harness.conversations.ensureMediaStored.mockResolvedValue('fetch_failed');

    await harness.service.process({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.adapter.transcribe).not.toHaveBeenCalled();
    expect(lastTranscriptionUpsert(harness.prisma)?.update).toMatchObject({
      status: TranscriptionStatus.FAILED,
      retryable: true,
      errorCode: 'AI_TRANSCRIPTION_MEDIA_UNAVAILABLE',
    });
  });

  it('creates the missing state and enqueues an old audio without a transcription row', async () => {
    const harness = createHarness();
    harness.prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      type: MessageType.AUDIO,
      direction: MessageDirection.INBOUND,
      metadata: { audioDurationSeconds: 8 },
      transcription: null,
    });
    harness.prisma.messageTranscription.upsert.mockResolvedValue({
      id: 'transcription-1',
      status: TranscriptionStatus.PENDING,
      text: null,
      language: null,
      provider: null,
      model: null,
      attempts: 0,
      retryable: true,
      errorCode: null,
      errorMessage: null,
      transcribedAt: null,
    });

    const view = await harness.service.retry('conversation-1', 'message-1');

    expect(view.status).toBe(TranscriptionStatus.PENDING);
    expect(harness.prisma.messageTranscription.upsert).toHaveBeenCalledWith({
      where: { messageId: 'message-1' },
      create: {
        tenantId: 'tenant-1',
        messageId: 'message-1',
        status: TranscriptionStatus.PENDING,
      },
      update: {},
    });
    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      'transcription.process',
      { tenantId: 'tenant-1', messageId: 'message-1' },
      { jobId: 'transcription-message-1' },
    );
  });

  it('does not create transcription state for non-audio messages missing a row', async () => {
    const harness = createHarness();
    harness.prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      type: MessageType.TEXT,
      direction: MessageDirection.INBOUND,
      metadata: {},
      transcription: null,
    });

    await expect(harness.service.retry('conversation-1', 'message-1')).rejects.toMatchObject({
      code: 'AI_TRANSCRIPTION_NOT_AVAILABLE',
    });
    expect(harness.queue.enqueue).not.toHaveBeenCalled();
  });

  it('allows retrying an audio that was received before transcription was enabled', async () => {
    const harness = createHarness();
    harness.prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      type: MessageType.AUDIO,
      direction: MessageDirection.INBOUND,
      metadata: {},
      transcription: {
        id: 'transcription-1',
        status: TranscriptionStatus.NOT_APPLICABLE,
        retryable: false,
        errorCode: 'AI_TRANSCRIPTION_DISABLED',
        updatedAt: new Date(),
      },
    });
    harness.prisma.messageTranscription.update.mockResolvedValue({
      id: 'transcription-1',
      status: TranscriptionStatus.PENDING,
      text: null,
      language: null,
      provider: null,
      model: null,
      attempts: 0,
      retryable: true,
      errorCode: null,
      errorMessage: null,
      transcribedAt: null,
    });

    const view = await harness.service.retry('conversation-1', 'message-1');

    expect(view.status).toBe(TranscriptionStatus.PENDING);
    expect(harness.settings.get).toHaveBeenCalled();
    expect(harness.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects retrying a disabled audio while the configuration is unavailable', async () => {
    const harness = createHarness();
    harness.settings.get.mockResolvedValue({ available: false });
    harness.prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      type: MessageType.AUDIO,
      direction: MessageDirection.INBOUND,
      metadata: {},
      transcription: {
        id: 'transcription-1',
        status: TranscriptionStatus.NOT_APPLICABLE,
        retryable: false,
        errorCode: 'AI_TRANSCRIPTION_DISABLED',
        updatedAt: new Date(),
      },
    });

    await expect(harness.service.retry('conversation-1', 'message-1')).rejects.toMatchObject({
      code: 'AI_TRANSCRIPTION_RETRY_UNAVAILABLE',
    });
    expect(harness.queue.enqueue).not.toHaveBeenCalled();
  });

  it('allows a manual retry only for a failed, retryable transcription', async () => {
    const harness = createHarness();
    harness.prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      type: MessageType.AUDIO,
      direction: MessageDirection.INBOUND,
      metadata: {},
      transcription: {
        id: 'transcription-1',
        status: TranscriptionStatus.FAILED,
        retryable: true,
        updatedAt: new Date(),
      },
    });
    harness.prisma.messageTranscription.update.mockResolvedValue({
      id: 'transcription-1',
      status: TranscriptionStatus.PENDING,
      text: null,
      language: null,
      provider: null,
      model: null,
      attempts: 1,
      retryable: true,
      errorCode: null,
      errorMessage: null,
      transcribedAt: null,
    });

    const view = await harness.service.retry('conversation-1', 'message-1');

    expect(view.status).toBe(TranscriptionStatus.PENDING);
    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      'transcription.process',
      { tenantId: 'tenant-1', messageId: 'message-1' },
      expect.objectContaining({ jobId: expect.stringContaining('transcription-message-1-retry-') }),
    );
  });
});
