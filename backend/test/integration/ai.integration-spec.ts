import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AiProvider } from '@prisma/client';
import { EncryptionService } from '../../src/infrastructure/crypto/encryption.service.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { AiProviderFailure } from '../../src/modules/ai/ai.provider.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

interface FakeProvider {
  id: AiProvider;
  complete: ReturnType<typeof vi.fn>;
}

describe('AI settings and formalization (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;
  let provider: FakeProvider;
  let factory: { get: ReturnType<typeof vi.fn> };
  let transcriptionAdapter: { transcribe: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> };
  let transcriptionFactory: { get: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    provider = {
      id: AiProvider.OPENAI,
      complete: vi.fn(),
    };
    factory = { get: vi.fn(() => provider) };
    transcriptionAdapter = {
      transcribe: vi.fn().mockResolvedValue({
        text: 'Transcrição de teste.',
        language: 'pt',
        provider: 'OPENAI',
        model: 'whisper-1',
      }),
      check: vi.fn().mockResolvedValue(undefined),
    };
    transcriptionFactory = { get: vi.fn(() => transcriptionAdapter) };
    context = await createTestApp({
      aiProviderFactory: factory,
      transcriptionProviderFactory: transcriptionFactory,
    });
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    provider.complete.mockReset();
    provider.complete.mockResolvedValue('OK');
    factory.get.mockClear();
    transcriptionAdapter.check.mockReset();
    transcriptionAdapter.check.mockResolvedValue(undefined);
    transcriptionFactory.get.mockClear();

    const suffix = Date.now().toString();
    ownerA = await seedTenant(app, prisma, { name: `AI Owner A ${suffix}`, role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, {
      name: `AI User A ${suffix}`,
      role: 'USER',
    });
    ownerB = await seedTenant(app, prisma, { name: `AI Owner B ${suffix}`, role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  function saveSettings(tenant: SeededTenant, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: '/api/ai/settings',
      headers: authHeaders(tenant),
      payload,
    });
  }

  function getSettings(tenant: SeededTenant) {
    return app.inject({
      method: 'GET',
      url: '/api/ai/settings',
      headers: authHeaders(tenant),
    });
  }

  function formalize(tenant: SeededTenant, text: string) {
    return app.inject({
      method: 'POST',
      url: '/api/ai/formalize',
      headers: authHeaders(tenant),
      payload: { text },
    });
  }

  it('saves the configuration, encrypts the credential and never returns it', async () => {
    const secret = 'sk-owner-a-secret-value';
    const saved = await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'FORMAL',
      enabled: true,
      apiKey: secret,
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'FORMAL',
      hasCredentials: true,
      available: true,
      configuredProviders: ['OPENAI'],
    });
    expect(saved.body).not.toContain(secret);
    expect(saved.json()).not.toHaveProperty('openaiApiKeyEncrypted');

    const listed = await getSettings(ownerA);
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(secret);
    expect(listed.json()).not.toHaveProperty('tenantId');

    const row = await prisma.aiSettings.findUniqueOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(row.openaiApiKeyEncrypted).not.toBe(secret);
    expect(app.get(EncryptionService).decrypt(row.openaiApiKeyEncrypted as string)).toBe(secret);
  });

  it('keeps settings and credentials isolated between tenants', async () => {
    await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'PROFESSIONAL',
      apiKey: 'sk-tenant-a',
    });
    await saveSettings(ownerB, {
      provider: 'DEEPSEEK',
      model: 'deepseek-flash',
      formality: 'VERY_FORMAL',
      apiKey: 'sk-tenant-b',
    });

    const settingsA = await getSettings(ownerA);
    const settingsB = await getSettings(ownerB);

    expect(settingsA.json()).toMatchObject({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      configuredProviders: ['OPENAI'],
    });
    expect(settingsB.json()).toMatchObject({
      provider: 'DEEPSEEK',
      model: 'deepseek-flash',
      configuredProviders: ['DEEPSEEK'],
    });

    provider.complete.mockResolvedValue('Texto reformulado.');
    await formalize(ownerA, 'mensagem a');

    expect(provider.complete).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'gpt-6-luna',
        apiKey: 'sk-tenant-a',
        systemPrompt: expect.stringContaining('Nível de formalidade: Profissional'),
      }),
    );

    const rows = await prisma.aiSettings.findMany({
      where: { tenantId: { in: [ownerA.tenantId, ownerB.tenantId] } },
    });
    expect(rows).toHaveLength(2);
  });

  it('supports Anthropic and OpenRouter with provider-specific credentials', async () => {
    const anthropicKey = 'sk-ant-integration-secret';
    const anthropic = await saveSettings(ownerA, {
      provider: 'ANTHROPIC',
      model: 'claude-haiku-5-5',
      formality: 'FORMAL',
      apiKey: anthropicKey,
    });

    expect(anthropic.statusCode).toBe(200);
    expect(anthropic.json()).toMatchObject({
      provider: 'ANTHROPIC',
      model: 'claude-haiku-5-5',
      available: true,
      configuredProviders: ['ANTHROPIC'],
    });
    expect(anthropic.body).not.toContain(anthropicKey);

    provider.complete.mockResolvedValue('Mensagem com Claude.');
    const anthropicResult = await formalize(ownerA, 'mensagem claude');
    expect(anthropicResult.statusCode).toBe(200);
    expect(factory.get).toHaveBeenLastCalledWith(AiProvider.ANTHROPIC);
    expect(provider.complete).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-5-5',
        apiKey: anthropicKey,
        systemPrompt: expect.stringContaining('Nível de formalidade: Formal'),
      }),
    );

    const openRouterKey = 'sk-or-integration-secret';
    const openRouter = await saveSettings(ownerA, {
      provider: 'OPENROUTER',
      model: 'openai/gpt-5.4-mini',
      formality: 'VERY_FORMAL',
      apiKey: openRouterKey,
    });

    expect(openRouter.statusCode).toBe(200);
    expect(openRouter.json()).toMatchObject({
      provider: 'OPENROUTER',
      model: 'openai/gpt-5.4-mini',
      available: true,
      configuredProviders: ['ANTHROPIC', 'OPENROUTER'],
    });
    expect(openRouter.body).not.toContain(openRouterKey);

    provider.complete.mockResolvedValue('Mensagem via OpenRouter.');
    const openRouterResult = await formalize(ownerA, 'mensagem openrouter');
    expect(openRouterResult.statusCode).toBe(200);
    expect(openRouterResult.json()).toEqual({ text: 'Mensagem via OpenRouter.' });
    expect(factory.get).toHaveBeenLastCalledWith(AiProvider.OPENROUTER);
    expect(provider.complete).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-5.4-mini',
        apiKey: openRouterKey,
        systemPrompt: expect.stringContaining('Nível de formalidade: Muito formal'),
      }),
    );

    const stored = await prisma.aiSettings.findUniqueOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    const encryption = app.get(EncryptionService);
    expect(encryption.decrypt(stored.anthropicApiKeyEncrypted as string)).toBe(anthropicKey);
    expect(encryption.decrypt(stored.openrouterApiKeyEncrypted as string)).toBe(openRouterKey);
  });

  it('does not expose the button for tenants without a usable configuration', async () => {
    const settings = await getSettings(ownerA);

    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      hasCredentials: false,
      available: false,
      configuredProviders: [],
    });

    await expect(formalize(ownerA, 'oi')).resolves.toMatchObject({
      statusCode: 409,
    });
  });

  it('allows members to read and formalize but not to change the configuration', async () => {
    await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'FORMAL',
      apiKey: 'sk-owner-a',
    });

    const read = await getSettings(userA);
    expect(read.statusCode).toBe(200);
    expect(read.json().available).toBe(true);

    const update = await saveSettings(userA, {
      provider: 'DEEPSEEK',
      model: 'deepseek-flash',
      formality: 'FORMAL',
    });
    expect(update.statusCode).toBe(403);

    const test = await app.inject({
      method: 'POST',
      url: '/api/ai/test',
      headers: authHeaders(userA),
      payload: { provider: 'OPENAI', model: 'gpt-6-luna', apiKey: 'sk-other' },
    });
    expect(test.statusCode).toBe(403);

    provider.complete.mockResolvedValue('Olá, tudo bem?');
    const result = await formalize(userA, 'oi td bem');
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ text: 'Olá, tudo bem?' });
  });

  it('uses the saved formality level in the provider request', async () => {
    await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'VERY_FORMAL',
      apiKey: 'sk-owner-a',
    });
    provider.complete.mockResolvedValue(
      'Prezado cliente, informamos que o pedido 123 foi enviado.',
    );

    const result = await formalize(ownerA, 'oi, o pedido 123 foi enviado');

    expect(result.statusCode).toBe(200);
    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        userContent: 'oi, o pedido 123 foi enviado',
        systemPrompt: expect.stringContaining('Nível de formalidade: Muito formal'),
        model: 'gpt-6-luna',
      }),
    );
    expect(result.json()).toEqual({
      text: 'Prezado cliente, informamos que o pedido 123 foi enviado.',
    });
  });

  it('rejects provider and model combinations that do not exist', async () => {
    const result = await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'deepseek-flash',
      formality: 'FORMAL',
      apiKey: 'sk-owner-a',
    });

    expect(result.statusCode).toBe(400);
    expect(result.json().code).toBe('AI_MODEL_NOT_SUPPORTED');
    expect(await prisma.aiSettings.findUnique({ where: { tenantId: ownerA.tenantId } })).toBeNull();
  });

  it('tests connectivity with unsaved credentials without persisting them', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/ai/test',
      headers: authHeaders(ownerA),
      payload: {
        provider: 'OPENAI',
        model: 'gpt-6-luna',
        apiKey: 'sk-temporary',
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ ok: true, provider: 'OPENAI', model: 'gpt-6-luna' });
    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-temporary', model: 'gpt-6-luna' }),
    );
    expect(await prisma.aiSettings.findUnique({ where: { tenantId: ownerA.tenantId } })).toBeNull();
  });

  it('returns safe errors when the provider rejects the credential', async () => {
    await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'FORMAL',
      apiKey: 'sk-owner-a-secret',
    });
    provider.complete.mockRejectedValue(new AiProviderFailure('auth'));

    const result = await formalize(ownerA, 'texto original');

    expect(result.statusCode).toBe(502);
    expect(result.json().code).toBe('AI_PROVIDER_AUTH_FAILED');
    expect(result.body).not.toContain('sk-owner-a-secret');
  });

  function saveTranscription(tenant: SeededTenant, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: '/api/ai/transcription/settings',
      headers: authHeaders(tenant),
      payload,
    });
  }

  it('reuses the existing OpenAI credential without storing a second key', async () => {
    const secret = 'sk-owner-a-transcription-secret';
    await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'FORMAL',
      apiKey: secret,
    });
    const before = await prisma.aiSettings.findUniqueOrThrow({
      where: { tenantId: ownerA.tenantId },
    });

    const saved = await saveTranscription(ownerA, {
      enabled: true,
      provider: 'OPENAI',
      model: 'whisper-1',
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      enabled: true,
      provider: 'OPENAI',
      model: 'whisper-1',
      supported: true,
      hasCredentials: true,
      credentialProvider: 'OPENAI',
      available: true,
      reason: null,
    });
    expect(saved.body).not.toContain(secret);
    expect(saved.json()).not.toHaveProperty('openaiApiKeyEncrypted');

    const after = await prisma.aiSettings.findUniqueOrThrow({
      where: { tenantId: ownerA.tenantId },
    });
    expect(after.openaiApiKeyEncrypted).toBe(before.openaiApiKeyEncrypted);
  });

  it('rejects providers without speech-to-text support and invalid models', async () => {
    const unsupported = await saveTranscription(ownerA, {
      enabled: true,
      provider: 'DEEPSEEK',
      model: 'whisper-1',
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().code).toBe('AI_TRANSCRIPTION_PROVIDER_UNSUPPORTED');

    const invalidModel = await saveTranscription(ownerA, {
      enabled: true,
      provider: 'OPENAI',
      model: 'gpt-6-luna',
    });
    expect(invalidModel.statusCode).toBe(400);
    expect(invalidModel.json().code).toBe('AI_TRANSCRIPTION_MODEL_NOT_SUPPORTED');
  });

  it('keeps transcription settings isolated between tenants', async () => {
    await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'FORMAL',
      apiKey: 'sk-tenant-a-transcription',
    });
    await saveTranscription(ownerA, {
      enabled: true,
      provider: 'OPENAI',
      model: 'gpt-4o-mini-transcribe',
    });

    const ownerAView = await app.inject({
      method: 'GET',
      url: '/api/ai/transcription/settings',
      headers: authHeaders(ownerA),
    });
    const ownerBView = await app.inject({
      method: 'GET',
      url: '/api/ai/transcription/settings',
      headers: authHeaders(ownerB),
    });

    expect(ownerAView.json()).toMatchObject({
      enabled: true,
      model: 'gpt-4o-mini-transcribe',
      available: true,
    });
    expect(ownerBView.json()).toMatchObject({
      enabled: false,
      hasCredentials: false,
      available: false,
      reason: 'missing_credentials',
    });
  });

  it('tests the stored transcription credential without sending audio or leaking the key', async () => {
    await saveSettings(ownerA, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'FORMAL',
      apiKey: 'sk-transcription-test-secret',
    });
    await saveTranscription(ownerA, {
      enabled: true,
      provider: 'OPENAI',
      model: 'whisper-1',
    });

    const result = await app.inject({
      method: 'POST',
      url: '/api/ai/transcription/test',
      headers: authHeaders(ownerA),
      payload: {},
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ ok: true, provider: 'OPENAI', model: 'whisper-1' });
    expect(transcriptionAdapter.check).toHaveBeenCalledWith({
      apiKey: 'sk-transcription-test-secret',
      model: 'whisper-1',
    });
    expect(transcriptionAdapter.transcribe).not.toHaveBeenCalled();
    expect(result.body).not.toContain('sk-transcription-test-secret');
  });

  it('restricts transcription changes to owners and admins', async () => {
    const result = await saveTranscription(userA, {
      enabled: true,
      provider: 'OPENAI',
      model: 'whisper-1',
    });

    expect(result.statusCode).toBe(403);
  });
});
