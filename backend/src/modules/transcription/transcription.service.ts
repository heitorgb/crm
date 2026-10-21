import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageDirection, MessageType, Prisma, TranscriptionStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import { ConversationProcessingService } from '../conversations/conversation-processing.service.js';
import {
  AudioConversionFailure,
  AudioConversionService,
} from './audio-conversion.service.js';
import {
  TranscriptionMessageNotFoundError,
  TranscriptionNotAvailableError,
  TranscriptionRetryNotAllowedError,
  TranscriptionRetryUnavailableError,
} from './transcription.errors.js';
import {
  audioExtensionForMime,
  isSupportedAudioMime,
  normalizeAudioMime,
  TRANSCRIPTION_MAX_TEXT_CHARS,
} from './transcription.models.js';
import {
  TranscriptionProviderFailure,
  type TranscriptionFailureKind,
} from './transcription.provider.js';
import { TranscriptionProviderFactory } from './transcription.providers.js';
import { TranscriptionSettingsService } from './transcription-settings.service.js';
import { toTranscriptionView, type MessageTranscriptionView } from './transcription.view.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const STALE_PROCESSING_MS = 5 * 60 * 1000;

interface ErrorDefinition {
  code: string;
  message: string;
  retryable: boolean;
}

interface FailureContext {
  provider?: string;
  model?: string;
  stage: string;
  attempts?: number;
  durationMs?: number;
  conversationId?: string;
}

const PROVIDER_FAILURES: Record<TranscriptionFailureKind, ErrorDefinition> = {
  auth: {
    code: 'AI_TRANSCRIPTION_AUTH_FAILED',
    message: 'O provedor de transcrição recusou a credencial configurada.',
    retryable: false,
  },
  rate_limit: {
    code: 'AI_TRANSCRIPTION_RATE_LIMITED',
    message: 'O provedor de transcrição atingiu o limite de requisições.',
    retryable: true,
  },
  quota: {
    code: 'AI_TRANSCRIPTION_QUOTA_EXCEEDED',
    message: 'A cota ou o saldo do provedor de transcrição é insuficiente.',
    retryable: false,
  },
  model_unavailable: {
    code: 'AI_TRANSCRIPTION_MODEL_UNAVAILABLE',
    message: 'O modelo de transcrição não está disponível no provedor.',
    retryable: false,
  },
  timeout: {
    code: 'AI_TRANSCRIPTION_TIMEOUT',
    message: 'O provedor de transcrição demorou demais para responder.',
    retryable: true,
  },
  connection: {
    code: 'AI_TRANSCRIPTION_UNAVAILABLE',
    message: 'Não foi possível conectar ao provedor de transcrição.',
    retryable: true,
  },
  provider: {
    code: 'AI_TRANSCRIPTION_UNAVAILABLE',
    message: 'O provedor de transcrição está indisponível no momento.',
    retryable: true,
  },
  invalid_response: {
    code: 'AI_TRANSCRIPTION_INVALID_RESPONSE',
    message: 'O provedor de transcrição retornou uma resposta inválida.',
    retryable: false,
  },
  file_rejected: {
    code: 'AI_TRANSCRIPTION_FILE_REJECTED',
    message: 'O formato ou o conteúdo do áudio não foi aceito pelo provedor.',
    retryable: false,
  },
  invalid_request: {
    code: 'AI_TRANSCRIPTION_INVALID_REQUEST',
    message: 'O provedor recusou a solicitação de transcrição.',
    retryable: false,
  },
};

const PERMANENT_LOCAL_FAILURES: Record<string, ErrorDefinition> = {
  AI_TRANSCRIPTION_FILE_TOO_LARGE: {
    code: 'AI_TRANSCRIPTION_FILE_TOO_LARGE',
    message: 'O áudio excede o tamanho máximo permitido para transcrição.',
    retryable: false,
  },
  AI_TRANSCRIPTION_AUDIO_TOO_LONG: {
    code: 'AI_TRANSCRIPTION_AUDIO_TOO_LONG',
    message: 'O áudio excede a duração máxima permitida para transcrição.',
    retryable: false,
  },
  AI_TRANSCRIPTION_UNSUPPORTED_FORMAT: {
    code: 'AI_TRANSCRIPTION_UNSUPPORTED_FORMAT',
    message: 'O formato do áudio não é compatível com a transcrição.',
    retryable: false,
  },
  AI_TRANSCRIPTION_DISABLED: {
    code: 'AI_TRANSCRIPTION_DISABLED',
    message: 'A transcrição automática está desativada para esta organização.',
    retryable: false,
  },
  AI_TRANSCRIPTION_PROVIDER_UNSUPPORTED: {
    code: 'AI_TRANSCRIPTION_PROVIDER_UNSUPPORTED',
    message: 'O provedor configurado não oferece transcrição de áudio.',
    retryable: false,
  },
  AI_TRANSCRIPTION_NOT_CONFIGURED: {
    code: 'AI_TRANSCRIPTION_NOT_CONFIGURED',
    message: 'A transcrição de áudio ainda não está configurada.',
    retryable: false,
  },
  AI_TRANSCRIPTION_CREDENTIALS_REQUIRED: {
    code: 'AI_TRANSCRIPTION_CREDENTIALS_REQUIRED',
    message: 'A credencial da OpenAI não está configurada para transcrição.',
    retryable: false,
  },
};

const CONVERSION_FAILURES: Record<string, ErrorDefinition> = {
  ffmpeg_unavailable: {
    code: 'AI_TRANSCRIPTION_CONVERSION_UNAVAILABLE',
    message: 'O servidor não possui o conversor de áudio necessário.',
    retryable: true,
  },
  timeout: {
    code: 'AI_TRANSCRIPTION_CONVERSION_TIMEOUT',
    message: 'A conversão do áudio demorou demais para concluir.',
    retryable: true,
  },
  too_large: {
    code: 'AI_TRANSCRIPTION_FILE_TOO_LARGE',
    message: 'O áudio convertido excede o tamanho máximo permitido para transcrição.',
    retryable: false,
  },
  conversion_failed: {
    code: 'AI_TRANSCRIPTION_CONVERSION_FAILED',
    message: 'Não foi possível converter o áudio para um formato aceito pelo provedor.',
    retryable: false,
  },
};

const RETRYABLE_LOCAL_FAILURES: Record<string, ErrorDefinition> = {
  AI_TRANSCRIPTION_MEDIA_UNAVAILABLE: {
    code: 'AI_TRANSCRIPTION_MEDIA_UNAVAILABLE',
    message: 'O arquivo de áudio não está disponível no momento.',
    retryable: true,
  },
  AI_TRANSCRIPTION_FILE_UNAVAILABLE: {
    code: 'AI_TRANSCRIPTION_FILE_UNAVAILABLE',
    message: 'Não foi possível ler o arquivo de áudio armazenado.',
    retryable: true,
  },
};

class ConcurrencyLimiter {
  private active = 0;
  private readonly activeByKey = new Map<string, number>();
  private readonly waiters: Array<{ key: string; resolve: () => void }> = [];

  constructor(
    private readonly globalLimit: number,
    private readonly perKeyLimit: number,
  ) {}

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private acquire(key: string): Promise<() => void> {
    return new Promise((resolve) => {
      this.waiters.push({
        key,
        resolve: () => resolve(() => this.release(key)),
      });
      this.drain();
    });
  }

  private drain(): void {
    for (let index = 0; index < this.waiters.length; ) {
      const waiter = this.waiters[index];
      const keyActive = this.activeByKey.get(waiter.key) ?? 0;
      if (this.active >= this.globalLimit || keyActive >= this.perKeyLimit) {
        index += 1;
        continue;
      }

      this.waiters.splice(index, 1);
      this.active += 1;
      this.activeByKey.set(waiter.key, keyActive + 1);
      waiter.resolve();
    }
  }

  private release(key: string): void {
    this.active = Math.max(0, this.active - 1);
    const keyActive = Math.max(0, (this.activeByKey.get(key) ?? 1) - 1);
    if (keyActive === 0) {
      this.activeByKey.delete(key);
    } else {
      this.activeByKey.set(key, keyActive);
    }
    this.drain();
  }
}

@Injectable()
export class TranscriptionService implements OnModuleInit {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly limiter: ConcurrencyLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly settings: TranscriptionSettingsService,
    private readonly providers: TranscriptionProviderFactory,
    private readonly conversion: AudioConversionService,
    private readonly conversations: ConversationProcessingService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService<Env, true>,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {
    this.limiter = new ConcurrencyLimiter(
      this.maxConcurrency,
      this.maxTenantConcurrency,
    );
  }

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.TRANSCRIPTION_PROCESS, (payload) =>
      this.process(payload),
    );
  }

  async testConnection(): Promise<{ ok: true; provider: string; model: string; message: string }> {
    const resolved = await this.settings.resolveForTest();
    const adapter = this.providers.get(resolved.provider);
    try {
      await adapter.check({ apiKey: resolved.apiKey, model: resolved.model });
    } catch (error) {
      throw toHttpError(error);
    }
    return {
      ok: true,
      provider: resolved.provider,
      model: resolved.model,
      message: 'Credencial e modelo de transcrição validados com sucesso.',
    };
  }

  async retry(conversationId: string, messageId: string): Promise<MessageTranscriptionView> {
    const { tenantId } = this.tenantContext.requireContext();
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId, conversationId },
      select: {
        id: true,
        type: true,
        direction: true,
        metadata: true,
        transcription: true,
      },
    });
    if (!message) {
      throw new TranscriptionMessageNotFoundError();
    }
    if (!message.transcription) {
      if (!isEligibleAudio(message)) {
        throw new TranscriptionNotAvailableError();
      }
      const current = await this.settings.get();
      if (!current.available) {
        throw new TranscriptionRetryUnavailableError();
      }

      const created = await this.prisma.messageTranscription.upsert({
        where: { messageId },
        create: {
          tenantId,
          messageId,
          status: TranscriptionStatus.PENDING,
        },
        update: {},
      });
      if (created.status !== TranscriptionStatus.COMPLETED) {
        await this.queue.enqueue(
          JOB_NAMES.TRANSCRIPTION_PROCESS,
          { tenantId, messageId },
          { jobId: `transcription-${messageId}` },
        );
      }
      return toTranscriptionView(created);
    }

    const row = message.transcription;
    if (row.status === TranscriptionStatus.COMPLETED) {
      return toTranscriptionView(row);
    }
    if (
      (row.status === TranscriptionStatus.PENDING || row.status === TranscriptionStatus.PROCESSING) &&
      row.updatedAt.getTime() > Date.now() - STALE_PROCESSING_MS
    ) {
      return toTranscriptionView(row);
    }
    if (row.status === TranscriptionStatus.FAILED && !row.retryable) {
      throw new TranscriptionRetryNotAllowedError();
    }
    if (row.status === TranscriptionStatus.NOT_APPLICABLE) {
      const current = await this.settings.get();
      if (!current.available) {
        throw new TranscriptionRetryUnavailableError();
      }
    }

    const updated = await this.prisma.messageTranscription.update({
      where: { id: row.id },
      data: {
        status: TranscriptionStatus.PENDING,
        retryable: true,
        errorCode: null,
        errorMessage: null,
      },
    });

    try {
      await this.queue.enqueue(
        JOB_NAMES.TRANSCRIPTION_PROCESS,
        { tenantId, messageId },
        { jobId: `transcription-${messageId}-retry-${randomUUID()}` },
      );
    } catch (error) {
      await this.prisma.messageTranscription.update({
        where: { id: row.id },
        data: {
          status: TranscriptionStatus.FAILED,
          retryable: true,
          errorCode: 'AI_TRANSCRIPTION_ENQUEUE_FAILED',
          errorMessage: 'Não foi possível enfileirar a transcrição. Tente novamente.',
        },
      });
      throw error;
    }

    return toTranscriptionView(updated);
  }

  async process(payload: JobPayload): Promise<void> {
    const tenantId = asString(payload.tenantId);
    const messageId = asString(payload.messageId);
    if (!tenantId || !messageId) {
      return;
    }

    await this.runAsTenant(tenantId, async () => {
      const message = await this.prisma.message.findFirst({
        where: { id: messageId, tenantId },
        select: {
          id: true,
          conversationId: true,
          type: true,
          direction: true,
          metadata: true,
          transcription: true,
          attachments: {
            select: {
              storageKey: true,
              fileName: true,
              mimeType: true,
              size: true,
            },
          },
        },
      });
      if (!message) {
        return;
      }
      if (!isEligibleAudio(message)) {
        await this.markNotApplicable(
          tenantId,
          messageId,
          {
            code: 'AI_TRANSCRIPTION_NOT_APPLICABLE',
            message: 'A mensagem não é um áudio recebido elegível para transcrição.',
            retryable: false,
          },
          message.conversationId,
        );
        return;
      }
      if (message.transcription?.status === TranscriptionStatus.COMPLETED) {
        return;
      }

      const resolved = await this.resolveSettings(tenantId, messageId, message.conversationId);
      if (!resolved) {
        return;
      }
      const usable = {
        provider: resolved.provider,
        model: resolved.model,
      };

      let attachment: {
        storageKey: string;
        fileName: string;
        mimeType: string;
        size: number;
      } | null = message.attachments[0] ?? null;
      if (!attachment) {
        const stored = await this.conversations.ensureMediaStored(tenantId, messageId);
        if (stored !== 'stored') {
          await this.markFailed(
            tenantId,
            messageId,
            RETRYABLE_LOCAL_FAILURES.AI_TRANSCRIPTION_MEDIA_UNAVAILABLE,
            { ...usable, stage: 'media_download', conversationId: message.conversationId },
          );
          return;
        }
        attachment = await this.prisma.messageAttachment.findFirst({
          where: { tenantId, messageId },
          select: { storageKey: true, fileName: true, mimeType: true, size: true },
        });
      }
      if (!attachment) {
        await this.markFailed(
          tenantId,
          messageId,
          RETRYABLE_LOCAL_FAILURES.AI_TRANSCRIPTION_MEDIA_UNAVAILABLE,
          { ...usable, stage: 'media_download', conversationId: message.conversationId },
        );
        return;
      }

      if (attachment.size > this.maxBytes) {
        await this.markFailed(
          tenantId,
          messageId,
          PERMANENT_LOCAL_FAILURES.AI_TRANSCRIPTION_FILE_TOO_LARGE,
          { ...usable, stage: 'validation', conversationId: message.conversationId },
        );
        return;
      }
      if (!isSupportedAudioMime(attachment.mimeType)) {
        await this.markFailed(
          tenantId,
          messageId,
          PERMANENT_LOCAL_FAILURES.AI_TRANSCRIPTION_UNSUPPORTED_FORMAT,
          { ...usable, stage: 'validation', conversationId: message.conversationId },
        );
        return;
      }
      const duration = readAudioDuration(message.metadata);
      if (duration !== null && duration > this.maxDurationSeconds) {
        await this.markFailed(
          tenantId,
          messageId,
          PERMANENT_LOCAL_FAILURES.AI_TRANSCRIPTION_AUDIO_TOO_LONG,
          { ...usable, stage: 'validation', conversationId: message.conversationId },
        );
        return;
      }

      const claimed = await this.claim(tenantId, messageId);
      if (!claimed) {
        return;
      }

      const adapter = this.providers.get(resolved.provider);
      const startedAt = Date.now();
      const language = this.config.get('TRANSCRIPTION_LANGUAGE');

      let originalAudio: Buffer;
      try {
        originalAudio = await this.readAudio(attachment.storageKey);
      } catch {
        await this.markFailed(
          tenantId,
          messageId,
          RETRYABLE_LOCAL_FAILURES.AI_TRANSCRIPTION_FILE_UNAVAILABLE,
          { ...usable, stage: 'media_read', conversationId: message.conversationId },
        );
        return;
      }

      let prepared;
      try {
        prepared = await this.limiter.run(tenantId, () =>
          this.conversion.prepare({
            audio: originalAudio,
            mimeType: attachment.mimeType,
            fileName: attachment.fileName,
          }),
        );
      } catch (error) {
        const reason =
          error instanceof AudioConversionFailure ? error.reason : 'conversion_failed';
        await this.markFailed(tenantId, messageId, CONVERSION_FAILURES[reason], {
          ...usable,
          stage: 'conversion',
          conversationId: message.conversationId,
        });
        return;
      }
      if (prepared.audio.length > this.maxBytes) {
        await this.markFailed(
          tenantId,
          messageId,
          PERMANENT_LOCAL_FAILURES.AI_TRANSCRIPTION_FILE_TOO_LARGE,
          { ...usable, stage: 'conversion', conversationId: message.conversationId },
        );
        return;
      }
      this.logger.debug(
        `transcription.audio.prepared ${JSON.stringify({
          tenantId,
          messageId,
          provider: resolved.provider,
          model: resolved.model,
          converted: prepared.converted,
          sourceMimeType: normalizeAudioMime(attachment.mimeType),
          targetMimeType: normalizeAudioMime(prepared.mimeType),
          size: prepared.audio.length,
        })}`,
      );

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        await this.prisma.messageTranscription.update({
          where: { messageId },
          data: { attempts: { increment: 1 } },
        });

        try {
          const result = await this.limiter.run(tenantId, () =>
            adapter.transcribe({
              model: resolved.model,
              apiKey: resolved.apiKey,
              audio: prepared.audio,
              mimeType: normalizeAudioMime(prepared.mimeType),
              fileName: safeFileName(prepared.fileName, prepared.mimeType),
              ...(language ? { language } : {}),
            }),
          );
          const text = normalizeText(result.text);
          if (!text) {
            throw new TranscriptionProviderFailure('invalid_response');
          }

          await this.prisma.messageTranscription.update({
            where: { messageId },
            data: {
              status: TranscriptionStatus.COMPLETED,
              text,
              language: result.language,
              provider: result.provider,
              model: result.model,
              retryable: false,
              errorCode: null,
              errorMessage: null,
              transcribedAt: new Date(),
            },
          });
          this.emitUpdated(tenantId, message.conversationId, messageId);
          this.logger.log(
            `transcription.completed ${JSON.stringify({
              tenantId,
              messageId,
              provider: result.provider,
              model: result.model,
              durationMs: Date.now() - startedAt,
              textLength: text.length,
            })}`,
          );
          return;
        } catch (error) {
          const failure =
            error instanceof TranscriptionProviderFailure
              ? error
              : new TranscriptionProviderFailure('provider');
          const definition = PROVIDER_FAILURES[failure.kind];
          const lastAttempt = attempt >= this.maxAttempts;
          if (!definition.retryable || lastAttempt) {
            await this.markFailed(tenantId, messageId, definition, {
              ...usable,
              stage: 'provider',
              attempts: attempt,
              durationMs: Date.now() - startedAt,
              conversationId: message.conversationId,
            });
            return;
          }
          await sleep(this.retryDelayMs * attempt);
        }
      }
    });
  }

  private async resolveSettings(tenantId: string, messageId: string, conversationId: string) {
    try {
      return await this.settings.getForExecution();
    } catch (error) {
      if (!(error instanceof AppException)) {
        throw error;
      }
      if (
        error.code === 'AI_TRANSCRIPTION_DISABLED' ||
        error.code === 'AI_TRANSCRIPTION_PROVIDER_UNSUPPORTED'
      ) {
        await this.markNotApplicable(
          tenantId,
          messageId,
          {
            code: error.code,
            message: error.message,
            retryable: false,
          },
          conversationId,
        );
      } else {
        await this.markFailed(
          tenantId,
          messageId,
          PERMANENT_LOCAL_FAILURES[error.code] ?? {
            code: error.code,
            message: error.message,
            retryable: false,
          },
          { stage: 'configuration', conversationId },
        );
      }
      return null;
    }
  }

  private async claim(tenantId: string, messageId: string): Promise<boolean> {
    await this.prisma.messageTranscription.upsert({
      where: { messageId },
      create: {
        tenantId,
        messageId,
        status: TranscriptionStatus.PENDING,
      },
      update: {},
    });

    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    const claimed = await this.prisma.messageTranscription.updateMany({
      where: {
        tenantId,
        messageId,
        OR: [
          { status: TranscriptionStatus.PENDING },
          { status: TranscriptionStatus.FAILED, retryable: true },
          { status: TranscriptionStatus.PROCESSING, updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: TranscriptionStatus.PROCESSING,
        retryable: true,
        errorCode: null,
        errorMessage: null,
      },
    });

    return claimed.count === 1;
  }

  private async markNotApplicable(
    tenantId: string,
    messageId: string,
    definition: ErrorDefinition,
    conversationId?: string,
  ): Promise<void> {
    await this.prisma.messageTranscription.upsert({
      where: { messageId },
      create: {
        tenantId,
        messageId,
        status: TranscriptionStatus.NOT_APPLICABLE,
        retryable: false,
        errorCode: definition.code,
        errorMessage: definition.message,
      },
      update: {
        status: TranscriptionStatus.NOT_APPLICABLE,
        text: null,
        retryable: false,
        errorCode: definition.code,
        errorMessage: definition.message,
      },
    });
    if (conversationId) {
      this.emitUpdated(tenantId, conversationId, messageId);
    }
  }

  private async markFailed(
    tenantId: string,
    messageId: string,
    definition: ErrorDefinition,
    context?: FailureContext,
  ): Promise<void> {
    const provider = context?.provider ?? null;
    const model = context?.model ?? null;
    await this.prisma.messageTranscription.upsert({
      where: { messageId },
      create: {
        tenantId,
        messageId,
        status: TranscriptionStatus.FAILED,
        retryable: definition.retryable,
        errorCode: definition.code,
        errorMessage: definition.message,
        provider,
        model,
      },
      update: {
        status: TranscriptionStatus.FAILED,
        retryable: definition.retryable,
        errorCode: definition.code,
        errorMessage: definition.message,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      },
    });
    if (context?.conversationId) {
      this.emitUpdated(tenantId, context.conversationId, messageId);
    }
    this.logger.warn(
      `transcription.failed ${JSON.stringify({
        tenantId,
        messageId,
        stage: context?.stage ?? 'processing',
        provider,
        model,
        attempts: context?.attempts ?? null,
        durationMs: context?.durationMs ?? null,
        errorCode: definition.code,
        retryable: definition.retryable,
      })}`,
    );
  }

  private async readAudio(storageKey: string): Promise<Buffer> {
    try {
      return await this.storage.get(storageKey);
    } catch {
      throw new TranscriptionProviderFailure('connection');
    }
  }

  private emitUpdated(tenantId: string, conversationId: string, messageId: string): void {
    this.realtime.emitToConversation(tenantId, conversationId, 'message.updated', {
      conversationId,
      messageId,
    });
    this.realtime.emitToTenant(tenantId, 'message.updated', { conversationId, messageId });
    this.realtime.emitToTenant(tenantId, 'conversation.updated', { conversationId, messageId });
  }

  private runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const context: TenantContext = {
      tenantId,
      userId: SYSTEM_USER_ID,
      membershipId: SYSTEM_MEMBERSHIP_ID,
      role: 'SYSTEM',
    };
    return this.tenantContext.run({ tenant: context }, fn);
  }

  private get maxConcurrency(): number {
    return this.config.get('TRANSCRIPTION_CONCURRENCY');
  }

  private get maxTenantConcurrency(): number {
    return this.config.get('TRANSCRIPTION_TENANT_CONCURRENCY');
  }

  private get maxAttempts(): number {
    return this.config.get('TRANSCRIPTION_MAX_ATTEMPTS');
  }

  private get retryDelayMs(): number {
    return this.config.get('TRANSCRIPTION_RETRY_DELAY_MS');
  }

  private get maxBytes(): number {
    return this.config.get('TRANSCRIPTION_MAX_BYTES');
  }

  private get maxDurationSeconds(): number {
    return this.config.get('TRANSCRIPTION_MAX_DURATION_SECONDS');
  }
}

function isEligibleAudio(message: {
  type: MessageType;
  direction: MessageDirection;
  metadata: Prisma.JsonValue;
}): boolean {
  if (message.type !== MessageType.AUDIO || message.direction !== MessageDirection.INBOUND) {
    return false;
  }
  return !(isRecord(message.metadata) && message.metadata.viewOnce === true);
}

function readAudioDuration(metadata: Prisma.JsonValue): number | null {
  if (!isRecord(metadata)) {
    return null;
  }
  const value = metadata.audioDurationSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeText(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }
  return text.length > TRANSCRIPTION_MAX_TEXT_CHARS
    ? text.slice(0, TRANSCRIPTION_MAX_TEXT_CHARS)
    : text;
}

function safeFileName(fileName: string, mimeType: string): string {
  const extension = audioExtensionForMime(mimeType);
  const base = fileName.replace(/[^\w.\- ]/g, '_').trim() || 'audio';
  return base.includes('.') ? base : `${base}.${extension}`;
}

function toHttpError(error: unknown): AppException {
  if (error instanceof AppException) {
    return error;
  }
  if (error instanceof TranscriptionProviderFailure) {
    const definition = PROVIDER_FAILURES[error.kind];
    return new AppException(definition.code, definition.message, 502);
  }
  return new AppException(
    'AI_TRANSCRIPTION_UNAVAILABLE',
    'Não foi possível validar a transcrição de áudio.',
    502,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
