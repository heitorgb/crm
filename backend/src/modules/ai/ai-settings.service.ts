import { Injectable } from '@nestjs/common';
import { AiFormality, AiProvider, Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  AiCredentialsRequiredError,
  AiCredentialsUnreadableError,
  AiDisabledError,
  AiEncryptionUnavailableError,
  AiModelNotSupportedError,
  AiNotConfiguredError,
} from './ai.errors.js';
import { AI_PROVIDERS, defaultModelFor, isModelSupported } from './ai.models.js';
import type { UpdateAiCredentialDto, UpdateAiSettingsDto } from './dto/ai.dto.js';

const SETTINGS_SELECT = {
  provider: true,
  model: true,
  formality: true,
  enabled: true,
  openaiApiKeyEncrypted: true,
  deepseekApiKeyEncrypted: true,
  anthropicApiKeyEncrypted: true,
  openrouterApiKeyEncrypted: true,
  updatedAt: true,
} satisfies Prisma.AiSettingsSelect;

type AiSettingsRow = Prisma.AiSettingsGetPayload<{ select: typeof SETTINGS_SELECT }>;

export interface AiSettingsView {
  provider: AiProvider;
  model: string;
  formality: AiSettingsRow['formality'];
  enabled: boolean;
  hasCredentials: boolean;
  configuredProviders: AiProvider[];
  available: boolean;
  updatedAt: Date | null;
}

export interface ResolvedAiSettings {
  provider: AiProvider;
  model: string;
  formality: AiSettingsRow['formality'];
  apiKey: string;
}

function credentialEncrypted(
  row: Pick<
    AiSettingsRow,
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

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly encryption: EncryptionService,
  ) {}

  async get(): Promise<AiSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const row = await this.prisma.aiSettings.findUnique({
      where: { tenantId },
      select: SETTINGS_SELECT,
    });

    return row ? toView(row) : emptyView();
  }

  async save(dto: UpdateAiSettingsDto): Promise<AiSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();

    if (!isModelSupported(dto.provider, dto.model)) {
      throw new AiModelNotSupportedError();
    }

    const apiKey = dto.apiKey?.trim();
    if (apiKey && !this.encryption.available) {
      throw new AiEncryptionUnavailableError();
    }

    const encryptedKey = apiKey ? this.encryption.encrypt(apiKey) : null;

    const update: Prisma.AiSettingsUpdateInput = {
      provider: dto.provider,
      model: dto.model,
      formality: dto.formality,
    };
    if (dto.enabled !== undefined) {
      update.enabled = dto.enabled;
    }
    applyCredentialUpdate(update, dto.provider, encryptedKey, dto.clearCredentials === true);

    const create: Prisma.AiSettingsCreateInput = {
      tenant: { connect: { id: tenantId } },
      provider: dto.provider,
      model: dto.model,
      formality: dto.formality,
      enabled: dto.enabled ?? true,
    };
    applyCredentialCreate(create, dto.provider, encryptedKey, dto.clearCredentials === true);

    const row = await this.prisma.aiSettings.upsert({
      where: { tenantId },
      update,
      create,
      select: SETTINGS_SELECT,
    });

    return toView(row);
  }

  async saveCredential(
    provider: AiProvider,
    dto: UpdateAiCredentialDto,
  ): Promise<AiSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const apiKey = dto.apiKey?.trim();
    const clear = dto.clearCredentials === true;

    if (!apiKey && !clear) {
      return this.get();
    }
    if (apiKey && !this.encryption.available) {
      throw new AiEncryptionUnavailableError();
    }

    const encryptedKey = apiKey ? this.encryption.encrypt(apiKey) : null;
    const update: Prisma.AiSettingsUpdateInput = {};
    applyCredentialUpdate(update, provider, encryptedKey, clear);

    const create: Prisma.AiSettingsCreateInput = {
      tenant: { connect: { id: tenantId } },
      provider: AiProvider.OPENAI,
      model: defaultModelFor(AiProvider.OPENAI),
      formality: AiFormality.PROFESSIONAL,
      enabled: true,
    };
    applyCredentialCreate(create, provider, encryptedKey, clear);

    const row = await this.prisma.aiSettings.upsert({
      where: { tenantId },
      update,
      create,
      select: SETTINGS_SELECT,
    });

    return toView(row);
  }

  async getForExecution(): Promise<ResolvedAiSettings> {
    const { tenantId } = this.tenantContext.requireContext();
    const row = await this.prisma.aiSettings.findUnique({
      where: { tenantId },
      select: SETTINGS_SELECT,
    });

    if (!row) {
      throw new AiNotConfiguredError();
    }
    if (!row.enabled) {
      throw new AiDisabledError();
    }
    if (!isModelSupported(row.provider, row.model)) {
      throw new AiModelNotSupportedError();
    }

    const apiKey = this.decryptCredential(credentialEncrypted(row, row.provider));
    if (!apiKey) {
      throw new AiCredentialsRequiredError();
    }

    return {
      provider: row.provider,
      model: row.model,
      formality: row.formality,
      apiKey,
    };
  }

  async resolveForTest(dto: {
    provider: AiProvider;
    model: string;
    apiKey?: string;
  }): Promise<{ apiKey: string }> {
    const { tenantId } = this.tenantContext.requireContext();

    if (!isModelSupported(dto.provider, dto.model)) {
      throw new AiModelNotSupportedError();
    }

    const row = await this.prisma.aiSettings.findUnique({
      where: { tenantId },
      select: SETTINGS_SELECT,
    });

    const providedKey = dto.apiKey?.trim();
    const apiKey =
      providedKey && providedKey.length > 0
        ? providedKey
        : row
          ? this.decryptCredential(credentialEncrypted(row, dto.provider))
          : null;
    if (!apiKey) {
      throw new AiCredentialsRequiredError();
    }

    return { apiKey };
  }

  private decryptCredential(encrypted: string | null): string | null {
    if (!encrypted) {
      return null;
    }
    if (!this.encryption.available) {
      throw new AiEncryptionUnavailableError();
    }

    try {
      return this.encryption.decrypt(encrypted);
    } catch {
      throw new AiCredentialsUnreadableError();
    }
  }
}

function applyCredentialUpdate(
  data: Prisma.AiSettingsUpdateInput,
  provider: AiProvider,
  encryptedKey: string | null,
  clear: boolean,
): void {
  if (!clear && !encryptedKey) {
    return;
  }

  const value = clear ? null : encryptedKey;
  switch (provider) {
    case AiProvider.OPENAI:
      data.openaiApiKeyEncrypted = value;
      break;
    case AiProvider.DEEPSEEK:
      data.deepseekApiKeyEncrypted = value;
      break;
    case AiProvider.ANTHROPIC:
      data.anthropicApiKeyEncrypted = value;
      break;
    case AiProvider.OPENROUTER:
      data.openrouterApiKeyEncrypted = value;
      break;
  }
}

function applyCredentialCreate(
  data: Prisma.AiSettingsCreateInput,
  provider: AiProvider,
  encryptedKey: string | null,
  clear: boolean,
): void {
  if (!clear && !encryptedKey) {
    return;
  }

  const value = clear ? null : encryptedKey;
  switch (provider) {
    case AiProvider.OPENAI:
      data.openaiApiKeyEncrypted = value;
      break;
    case AiProvider.DEEPSEEK:
      data.deepseekApiKeyEncrypted = value;
      break;
    case AiProvider.ANTHROPIC:
      data.anthropicApiKeyEncrypted = value;
      break;
    case AiProvider.OPENROUTER:
      data.openrouterApiKeyEncrypted = value;
      break;
  }
}

function configuredProviders(row: AiSettingsRow): AiProvider[] {
  return AI_PROVIDERS.filter((provider) => credentialEncrypted(row, provider.id)).map(
    (provider) => provider.id,
  );
}

function isAvailable(row: AiSettingsRow): boolean {
  return (
    row.enabled &&
    isModelSupported(row.provider, row.model) &&
    credentialEncrypted(row, row.provider) !== null
  );
}

function toView(row: AiSettingsRow): AiSettingsView {
  return {
    provider: row.provider,
    model: row.model,
    formality: row.formality,
    enabled: row.enabled,
    hasCredentials: credentialEncrypted(row, row.provider) !== null,
    configuredProviders: configuredProviders(row),
    available: isAvailable(row),
    updatedAt: row.updatedAt,
  };
}

function emptyView(): AiSettingsView {
  return {
    provider: AiProvider.OPENAI,
    model: defaultModelFor(AiProvider.OPENAI),
    formality: AiFormality.PROFESSIONAL,
    enabled: true,
    hasCredentials: false,
    configuredProviders: [],
    available: false,
    updatedAt: null,
  };
}
