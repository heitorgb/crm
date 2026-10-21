import { AiProvider } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import {
  AnthropicProvider,
  DeepSeekProvider,
  OpenAiProvider,
  OpenRouterProvider,
} from '../../../src/modules/ai/ai.providers.js';

const config = {
  get: vi.fn(() => 30_000),
} as unknown as ConfigService<Env, true>;

const baseInput = {
  model: 'model-id',
  apiKey: 'sk-secret',
  systemPrompt: 'system',
  userContent: 'texto',
  maxTokens: 100,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('OpenAiProvider', () => {
  it('uses the OpenAI chat completions endpoint and parses the message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ choices: [{ message: { content: 'Texto corrigido.' } }] }));
    globalThis.fetch = fetchMock;

    const result = await new OpenAiProvider(config).complete({
      ...baseInput,
      model: 'gpt-6-luna',
    });

    expect(result).toBe('Texto corrigido.');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('gpt-6-luna');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system' });
  });

  it('maps authentication and rate limit responses to provider failures', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({}, 401));
    await expect(new OpenAiProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'auth',
    });

    globalThis.fetch = vi.fn().mockResolvedValue(response({}, 429));
    await expect(new OpenAiProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'rate_limit',
    });

    globalThis.fetch = vi.fn().mockResolvedValue(response({}, 402));
    await expect(new OpenAiProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'quota',
    });
  });

  it('maps timeouts and empty responses', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(new OpenAiProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'timeout',
    });

    globalThis.fetch = vi.fn().mockResolvedValue(response({ choices: [] }));
    await expect(new OpenAiProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('DeepSeekProvider', () => {
  it('uses the DeepSeek endpoint and disables thinking mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ choices: [{ message: { content: 'Texto formal.' } }] }));
    globalThis.fetch = fetchMock;

    await new DeepSeekProvider(config).complete({ ...baseInput, model: 'deepseek-flash' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(init.body as string) as {
      model: string;
      thinking: { type: string };
    };
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});

describe('AnthropicProvider', () => {
  it('uses the Messages API, Anthropic headers and text content blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        content: [
          { type: 'thinking', thinking: 'internal' },
          { type: 'text', text: 'Texto Anthropic.' },
        ],
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await new AnthropicProvider(config).complete({
      ...baseInput,
      model: 'claude-haiku-5-5',
    });

    expect(result).toBe('Texto Anthropic.');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string) as {
      model: string;
      system: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.system).toBe('system');
    expect(body.messages).toEqual([{ role: 'user', content: 'texto' }]);
    expect(body.max_tokens).toBeGreaterThanOrEqual(512);
  });

  it('classifies authentication, quota and empty responses', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        response({ error: { type: 'authentication_error', message: 'invalid key' } }, 401),
      );
    await expect(new AnthropicProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'auth',
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        response(
          { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
          400,
        ),
      );
    await expect(new AnthropicProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'quota',
    });

    globalThis.fetch = vi.fn().mockResolvedValue(response({ content: [] }));
    await expect(new AnthropicProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('OpenRouterProvider', () => {
  it('uses the OpenRouter chat completions endpoint with the provider-prefixed model id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ choices: [{ message: { content: 'Texto OpenRouter.' } }] }));
    globalThis.fetch = fetchMock;

    const result = await new OpenRouterProvider(config).complete({
      ...baseInput,
      model: 'openai/gpt-5.4-mini',
    });

    expect(result).toBe('Texto OpenRouter.');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-secret');
    expect(headers['X-Title']).toBe('OrderUp CRM');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('openai/gpt-5.4-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system' });
  });

  it('maps insufficient credits and invalid responses', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ error: { code: 402, message: 'Insufficient credits' } }, 402));
    await expect(new OpenRouterProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'quota',
    });

    globalThis.fetch = vi.fn().mockResolvedValue(response({ choices: [] }));
    await expect(new OpenRouterProvider(config).complete(baseInput)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('provider catalog', () => {
  it('keeps provider ids aligned with the Prisma enum', () => {
    expect(Object.values(AiProvider)).toEqual(['OPENAI', 'DEEPSEEK', 'ANTHROPIC', 'OPENROUTER']);
  });
});
