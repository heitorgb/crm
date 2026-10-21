import { AiFormality, AiProvider } from '@prisma/client';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { EncryptionService } from '../../../src/infrastructure/crypto/encryption.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import {
  AiCredentialsRequiredError,
  AiModelNotSupportedError,
} from '../../../src/modules/ai/ai.errors.js';
import { AiSettingsService } from '../../../src/modules/ai/ai-settings.service.js';

interface PrismaMock {
  aiSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}

function createService(): {
  service: AiSettingsService;
  prisma: PrismaMock;
  encryption: {
    available: boolean;
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
  };
} {
  const prisma: PrismaMock = {
    aiSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
  const encryption = {
    available: true,
    encrypt: vi.fn((value: string) => `encrypted:${value}`),
    decrypt: vi.fn((value: string) => value.replace(/^encrypted:/, '')),
  };
  const tenantContext = {
    requireContext: vi.fn(() => ({
      tenantId: 'tenant-a',
      userId: 'user-a',
      membershipId: 'membership-a',
      role: 'OWNER',
    })),
  };

  return {
    service: new AiSettingsService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      encryption as unknown as EncryptionService,
    ),
    prisma,
    encryption,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    provider: AiProvider.OPENAI,
    model: 'gpt-6-luna',
    formality: AiFormality.PROFESSIONAL,
    enabled: true,
    openaiApiKeyEncrypted: 'encrypted:sk-openai',
    deepseekApiKeyEncrypted: null,
    anthropicApiKeyEncrypted: null,
    openrouterApiKeyEncrypted: null,
    updatedAt: new Date('2026-10-20T12:00:00.000Z'),
    ...overrides,
  };
}

describe('AiSettingsService', () => {
  it('returns an unavailable default view when the tenant has no configuration', async () => {
    const { service, prisma } = createService();
    prisma.aiSettings.findUnique.mockResolvedValue(null);

    const view = await service.get();

    expect(prisma.aiSettings.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
    expect(view).toMatchObject({
      provider: AiProvider.OPENAI,
      enabled: true,
      hasCredentials: false,
      available: false,
      configuredProviders: [],
    });
  });

  it('never exposes encrypted credentials in the settings view', async () => {
    const { service, prisma } = createService();
    prisma.aiSettings.findUnique.mockResolvedValue(
      row({
        deepseekApiKeyEncrypted: 'encrypted:sk-deepseek',
      }),
    );

    const view = await service.get();

    expect(view).toMatchObject({
      provider: AiProvider.OPENAI,
      hasCredentials: true,
      available: true,
      configuredProviders: [AiProvider.OPENAI, AiProvider.DEEPSEEK],
    });
    expect(view).not.toHaveProperty('openaiApiKeyEncrypted');
    expect(view).not.toHaveProperty('deepseekApiKeyEncrypted');
    expect(JSON.stringify(view)).not.toContain('encrypted:');
  });

  it('rejects a model that does not belong to the selected provider', async () => {
    const { service, prisma } = createService();

    await expect(
      service.save({
        provider: AiProvider.OPENAI,
        model: 'deepseek-flash',
        formality: AiFormality.FORMAL,
      }),
    ).rejects.toBeInstanceOf(AiModelNotSupportedError);

    expect(prisma.aiSettings.upsert).not.toHaveBeenCalled();
  });

  it('encrypts a new key and does not overwrite it when the field is empty', async () => {
    const { service, prisma, encryption } = createService();
    prisma.aiSettings.upsert.mockResolvedValue(row());

    await service.save({
      provider: AiProvider.OPENAI,
      model: 'gpt-6-luna',
      formality: AiFormality.FORMAL,
      apiKey: 'sk-new',
    });

    expect(encryption.encrypt).toHaveBeenCalledWith('sk-new');
    expect(prisma.aiSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-a' },
        update: expect.objectContaining({
          openaiApiKeyEncrypted: 'encrypted:sk-new',
          formality: AiFormality.FORMAL,
        }),
      }),
    );

    prisma.aiSettings.upsert.mockClear();
    await service.save({
      provider: AiProvider.OPENAI,
      model: 'gpt-6-luna',
      formality: AiFormality.FORMAL,
    });

    const update = prisma.aiSettings.upsert.mock.calls[0][0].update as Record<string, unknown>;
    expect(update).not.toHaveProperty('openaiApiKeyEncrypted');
  });

  it('keeps credentials separated per provider', async () => {
    const { service, prisma } = createService();
    prisma.aiSettings.upsert.mockResolvedValue(
      row({ deepseekApiKeyEncrypted: 'encrypted:sk-deepseek' }),
    );

    await service.save({
      provider: AiProvider.DEEPSEEK,
      model: 'deepseek-flash',
      formality: AiFormality.PROFESSIONAL,
      apiKey: 'sk-deepseek',
    });

    const update = prisma.aiSettings.upsert.mock.calls[0][0].update as Record<string, unknown>;
    expect(update.deepseekApiKeyEncrypted).toBe('encrypted:sk-deepseek');
    expect(update).not.toHaveProperty('openaiApiKeyEncrypted');
    expect(update).not.toHaveProperty('anthropicApiKeyEncrypted');
    expect(update).not.toHaveProperty('openrouterApiKeyEncrypted');
  });

  it('decrypts only the credential of the configured provider for execution', async () => {
    const { service, prisma } = createService();
    prisma.aiSettings.findUnique.mockResolvedValue(
      row({
        provider: AiProvider.DEEPSEEK,
        model: 'deepseek-flash',
        deepseekApiKeyEncrypted: 'encrypted:sk-deepseek',
      }),
    );

    await expect(service.getForExecution()).resolves.toMatchObject({
      provider: AiProvider.DEEPSEEK,
      model: 'deepseek-flash',
      apiKey: 'sk-deepseek',
    });
  });

  it('does not reuse another provider credential when the selected one is missing', async () => {
    const { service, prisma } = createService();
    prisma.aiSettings.findUnique.mockResolvedValue(
      row({
        provider: AiProvider.ANTHROPIC,
        model: 'claude-haiku-5-5',
        openaiApiKeyEncrypted: 'encrypted:sk-openai',
        anthropicApiKeyEncrypted: null,
      }),
    );

    await expect(service.getForExecution()).rejects.toBeInstanceOf(AiCredentialsRequiredError);
  });

  it('decrypts Anthropic and OpenRouter credentials independently', async () => {
    const { service, prisma } = createService();

    prisma.aiSettings.findUnique.mockResolvedValue(
      row({
        provider: AiProvider.ANTHROPIC,
        model: 'claude-sonnet-5-5',
        anthropicApiKeyEncrypted: 'encrypted:sk-ant',
      }),
    );
    await expect(service.getForExecution()).resolves.toMatchObject({
      provider: AiProvider.ANTHROPIC,
      model: 'claude-sonnet-5-5',
      apiKey: 'sk-ant',
    });

    prisma.aiSettings.findUnique.mockResolvedValue(
      row({
        provider: AiProvider.OPENROUTER,
        model: 'openai/gpt-5.4-mini',
        openrouterApiKeyEncrypted: 'encrypted:sk-or',
      }),
    );
    await expect(service.getForExecution()).resolves.toMatchObject({
      provider: AiProvider.OPENROUTER,
      model: 'openai/gpt-5.4-mini',
      apiKey: 'sk-or',
    });
  });
});
