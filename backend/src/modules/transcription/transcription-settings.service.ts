import { Injectable } from '@nestjs/common';
import { AiFormality, AiProvider, Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { defaultModelFor } from '../ai/ai.models.js';
import type { UpdateTranscriptionSettingsDto } from './dto/transcription.dto.js';
import {
  TranscriptionCredentialsRequiredError,
  TranscriptionCredentialsUnreadableError,
  TranscriptionDisabledError,
  TranscriptionEncryptionUnavailableError,
  TranscriptionModelNotSupportedError,
  TranscriptionNotConfiguredError,
  TranscriptionProviderUnsupportedError,
} from './transcription.errors.js';
import {
  defaultTranscriptionModel,
  findTranscriptionProvider,
  isTranscriptionModelSupported,
  isTranscriptionProviderSupported,
} from './transcription.models.js';

const SETTINGS_SELECT = {
  transcriptionEnabled: true,
  transcriptionAutoEnabled: true,
  transcriptionProvider: true,
  transcriptionModel: true,
  openaiApiKeyEncrypted: true,
  deepseekApiKeyEncrypted: true,
  anthropicApiKeyEncrypted: true,
  openrouterApiKeyEncrypted: true,
  updatedAt: true,
} satisfies Prisma.AiSettingsSelect;

type SettingsRow = Prisma.AiSettingsGetPayload<{ select: typeof SETTINGS_SELECT }>;

export type TranscriptionUnavailableReason =
  | 'disabled'
  | 'provider_unsupported'
  | 'model_unsupported'
  | 'missing_credentials'
  | 'unreadable_credentials';

export interface TranscriptionSettingsView {
  enabled: boolean;
  autoEnabled: boolean;
  provider: AiProvider;
  model: string;
  supported: boolean;
  supportedModels: string[];
  hasCredentials: boolean;
  credentialProvider: AiProvider | null;
  available: boolean;
  reason: TranscriptionUnavailableReason | null;
  updatedAt: Date | null;
}

export interface ResolvedTranscriptionSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

@Injectable()
export class TranscriptionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly encryption: EncryptionService,
  ) {}

  async get(): Promise<TranscriptionSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const row = await this.prisma.aiSettings.findUnique({
      where: { tenantId },
      select: SETTINGS_SELECT,
    });

    return row ? this.toView(row) : emptyView();
  }

  async save(dto: UpdateTranscriptionSettingsDto): Promise<TranscriptionSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const autoEnabled = dto.autoEnabled ?? false;

    if (!isTranscriptionProviderSupported(dto.provider)) {
      throw new TranscriptionProviderUnsupportedError(
        findTranscriptionProvider(dto.provider).unsupportedReason ?? undefined,
      );
    }
    if (!isTranscriptionModelSupported(dto.provider, dto.model)) {
      throw new TranscriptionModelNotSupportedError();
    }

    const apiKey = dto.apiKey?.trim();
    if (apiKey && !this.encryption.available) {
      throw new TranscriptionEncryptionUnavailableError();
    }
    const encryptedKey = apiKey ? this.encryption.encrypt(apiKey) : null;

    const row = await this.prisma.aiSettings.upsert({
      where: { tenantId },
      create: {
        tenant: { connect: { id: tenantId } },
        provider: AiProvider.OPENAI,
        model: defaultModelFor(AiProvider.OPENAI),
        formality: AiFormality.PROFESSIONAL,
        transcriptionEnabled: dto.enabled,
        transcriptionAutoEnabled: autoEnabled,
        transcriptionProvider: dto.provider,
        transcriptionModel: dto.model,
        ...(encryptedKey ? { openaiApiKeyEncrypted: encryptedKey } : {}),
      },
      update: {
        transcriptionEnabled: dto.enabled,
        transcriptionAutoEnabled: autoEnabled,
        transcriptionProvider: dto.provider,
        transcriptionModel: dto.model,
        ...(encryptedKey ? { openaiApiKeyEncrypted: encryptedKey } : {}),
      },
      select: SETTINGS_SELECT,
    });

    return this.toView(row);
  }

  async isAutoEnabled(tenantId: string): Promise<boolean> {
    const row = await this.prisma.aiSettings.findUnique({
      where: { tenantId },
      select: { transcriptionEnabled: true, transcriptionAutoEnabled: true },
    });

    return row?.transcriptionEnabled === true && row.transcriptionAutoEnabled === true;
  }

  async getForExecution(): Promise<ResolvedTranscriptionSettings> {
    const { tenantId } = this.tenantContext.requireContext();
    const row = await this.prisma.aiSettings.findUnique({
      where: { tenantId },
      select: SETTINGS_SELECT,
    });

    if (!row) {
      throw new TranscriptionNotConfiguredError();
    }
    if (!row.transcriptionEnabled) {
      throw new TranscriptionDisabledError();
    }

    return this.resolveRow(row);
  }

  async resolveForTest(): Promise<ResolvedTranscriptionSettings> {
    const { tenantId } = this.tenantContext.requireContext();
    const row = await this.prisma.aiSettings.findUnique({
      where: { tenantId },
      select: SETTINGS_SELECT,
    });

    if (!row) {
      throw new TranscriptionNotConfiguredError();
    }

    return this.resolveRow(row);
  }

  private resolveRow(row: SettingsRow): ResolvedTranscriptionSettings {
    if (!isTranscriptionProviderSupported(row.transcriptionProvider)) {
      throw new TranscriptionProviderUnsupportedError(
        findTranscriptionProvider(row.transcriptionProvider).unsupportedReason ?? undefined,
      );
    }
    if (!isTranscriptionModelSupported(row.transcriptionProvider, row.transcriptionModel)) {
      throw new TranscriptionModelNotSupportedError();
    }

    const encrypted = credentialEncrypted(row, row.transcriptionProvider);
    if (!encrypted) {
      throw new TranscriptionCredentialsRequiredError();
    }
    if (!this.encryption.available) {
      throw new TranscriptionEncryptionUnavailableError();
    }

    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt(encrypted);
    } catch {
      throw new TranscriptionCredentialsUnreadableError();
    }

    return {
      provider: row.transcriptionProvider,
      model: row.transcriptionModel,
      apiKey,
    };
  }

  private toView(row: SettingsRow): TranscriptionSettingsView {
    const provider = row.transcriptionProvider;
    const providerSupported = isTranscriptionProviderSupported(provider);
    const modelSupported =
      providerSupported && isTranscriptionModelSupported(provider, row.transcriptionModel);
    const hasCredentials = providerSupported && credentialEncrypted(row, provider) !== null;

    let reason: TranscriptionUnavailableReason | null = null;
    if (!providerSupported) {
      reason = 'provider_unsupported';
    } else if (!modelSupported) {
      reason = 'model_unsupported';
    } else if (!hasCredentials) {
      reason = 'missing_credentials';
    } else if (!row.transcriptionEnabled) {
      reason = 'disabled';
    }

    return {
      enabled: row.transcriptionEnabled,
      autoEnabled: row.transcriptionAutoEnabled,
      provider,
      model: row.transcriptionModel,
      supported: providerSupported,
      supportedModels: findTranscriptionProvider(provider).models.map((item) => item.id),
      hasCredentials,
      credentialProvider: providerSupported ? provider : null,
      available: reason === null,
      reason,
      updatedAt: row.updatedAt,
    };
  }
}

function credentialEncrypted(
  row: Pick<
    SettingsRow,
    | 'openaiApiKeyEncrypted'
    | 'deepseekApiKeyEncrypted'
    | 'anthropicApiKeyEncrypted'
    | 'openrouterApiKeyEncrypted'
  >,
  provider: AiProvider,
): string | null {
  switch (provider) {
    case AiProvider.OPENAI:
      return row.openaiApiKeyEncrypted;
    case AiProvider.DEEPSEEK:
      return row.deepseekApiKeyEncrypted;
    case AiProvider.ANTHROPIC:
      return row.anthropicApiKeyEncrypted;
    case AiProvider.OPENROUTER:
      return row.openrouterApiKeyEncrypted;
  }
}

function emptyView(): TranscriptionSettingsView {
  return {
    enabled: false,
    autoEnabled: false,
    provider: AiProvider.OPENAI,
    model: defaultTranscriptionModel(AiProvider.OPENAI),
    supported: true,
    supportedModels: findTranscriptionProvider(AiProvider.OPENAI).models.map((item) => item.id),
    hasCredentials: false,
    credentialProvider: AiProvider.OPENAI,
    available: false,
    reason: 'missing_credentials',
    updatedAt: null,
  };
}
