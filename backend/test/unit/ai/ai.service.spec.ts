import { AiFormality, AiProvider } from '@prisma/client';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import { AiProviderFailure, type AiProviderAdapter } from '../../../src/modules/ai/ai.provider.js';
import type { AiProviderFactory } from '../../../src/modules/ai/ai.providers.js';
import { AiService } from '../../../src/modules/ai/ai.service.js';
import type { AiSettingsService } from '../../../src/modules/ai/ai-settings.service.js';

function createService(): {
  service: AiService;
  settings: {
    getForExecution: ReturnType<typeof vi.fn>;
    resolveForTest: ReturnType<typeof vi.fn>;
  };
  provider: { complete: ReturnType<typeof vi.fn>; id: AiProvider };
} {
  const settings = {
    getForExecution: vi.fn(),
    resolveForTest: vi.fn(),
  };
  const provider: AiProviderAdapter & { complete: ReturnType<typeof vi.fn> } = {
    id: AiProvider.OPENAI,
    complete: vi.fn().mockResolvedValue('Texto formalizado.'),
  };
  const factory = {
    get: vi.fn(() => provider),
  };
  const tenantContext = {
    requireContext: vi.fn(() => ({
      tenantId: 'tenant-a',
      userId: 'user-a',
      membershipId: 'membership-a',
      role: 'USER',
    })),
  };

  return {
    service: new AiService(
      settings as unknown as AiSettingsService,
      factory as unknown as AiProviderFactory,
      tenantContext as unknown as TenantContextService,
    ),
    settings,
    provider,
  };
}

describe('AiService', () => {
  it('formalizes using the saved provider, model and formality', async () => {
    const { service, settings, provider } = createService();
    settings.getForExecution.mockResolvedValue({
      provider: AiProvider.OPENAI,
      model: 'gpt-6-luna',
      formality: AiFormality.VERY_FORMAL,
      apiKey: 'sk-secret',
    });

    const result = await service.formalize('oi, preciso de ajuda');

    expect(result).toEqual({ text: 'Texto formalizado.' });
    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-6-luna',
        apiKey: 'sk-secret',
        userContent: 'oi, preciso de ajuda',
        systemPrompt: expect.stringContaining('Nível de formalidade: Muito formal'),
      }),
    );
  });

  it('maps provider failures to safe application errors', async () => {
    const { service, settings, provider } = createService();
    settings.getForExecution.mockResolvedValue({
      provider: AiProvider.DEEPSEEK,
      model: 'deepseek-flash',
      formality: AiFormality.FORMAL,
      apiKey: 'sk-secret',
    });
    provider.complete.mockRejectedValue(new AiProviderFailure('timeout'));

    await expect(service.formalize('texto')).rejects.toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
      statusCode: 504,
    });
  });

  it('prevents concurrent formalizations for the same user', async () => {
    const { service, settings, provider } = createService();
    settings.getForExecution.mockResolvedValue({
      provider: AiProvider.OPENAI,
      model: 'gpt-6-luna',
      formality: AiFormality.PROFESSIONAL,
      apiKey: 'sk-secret',
    });

    let finish: (value: string) => void = () => undefined;
    provider.complete.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );

    const first = service.formalize('primeira');
    await expect(service.formalize('segunda')).rejects.toMatchObject({
      code: 'AI_REQUEST_IN_PROGRESS',
    });

    finish('resultado');
    await expect(first).resolves.toEqual({ text: 'resultado' });
  });

  it('tests the provider with supplied credentials without saving them', async () => {
    const { service, settings, provider } = createService();
    settings.resolveForTest.mockResolvedValue({
      apiKey: 'sk-typed',
    });

    const result = await service.testConnection({
      provider: AiProvider.OPENAI,
      model: 'gpt-6-luna',
      apiKey: 'sk-typed',
    });

    expect(result).toEqual({
      ok: true,
      provider: AiProvider.OPENAI,
      model: 'gpt-6-luna',
      message: 'Conexão validada com sucesso.',
    });
    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-typed',
        model: 'gpt-6-luna',
      }),
    );
  });

  it('rejects authentication failures from the provider', async () => {
    const { service, settings, provider } = createService();
    settings.resolveForTest.mockResolvedValue({
      apiKey: 'sk-typed',
    });
    provider.complete.mockRejectedValue(new AiProviderFailure('auth'));

    await expect(
      service.testConnection({
        provider: AiProvider.OPENAI,
        model: 'gpt-6-luna',
        apiKey: 'sk-typed',
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_AUTH_FAILED' });
  });
});
