import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider } from '@prisma/client';
import type { Env } from '../../config/env.validation.js';
import {
  AiProviderFailure,
  type AiCompletionInput,
  type AiProviderAdapter,
} from './ai.provider.js';

interface HttpResult {
  status: number;
  ok: boolean;
  payload: unknown;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<HttpResult> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiProviderFailure('timeout');
    }
    throw new AiProviderFailure('connection');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { status: response.status, ok: response.ok, payload };
}

export function failureForStatus(status: number): AiProviderFailure {
  if (status === 401 || status === 403) {
    return new AiProviderFailure('auth');
  }
  if (status === 402) {
    return new AiProviderFailure('quota');
  }
  if (status === 429) {
    return new AiProviderFailure('rate_limit');
  }
  if (status === 400 || status === 404) {
    return new AiProviderFailure('model_unavailable');
  }
  if (status >= 500) {
    return new AiProviderFailure('provider');
  }
  return new AiProviderFailure('provider');
}

function normalizeText(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new AiProviderFailure('invalid_response');
  }

  let text = raw.trim();
  if (text.startsWith('```') && text.endsWith('```')) {
    text = text
      .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  if (text.length === 0) {
    throw new AiProviderFailure('invalid_response');
  }

  return text;
}

function openAiContent(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices;
  const content = choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }

  throw new AiProviderFailure('invalid_response');
}

function anthropicContent(payload: unknown): string {
  const content = (payload as { content?: Array<{ type?: string; text?: unknown }> } | null)
    ?.content;

  if (!Array.isArray(content)) {
    throw new AiProviderFailure('invalid_response');
  }

  const text = content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');

  if (text.trim().length === 0) {
    throw new AiProviderFailure('invalid_response');
  }

  return text;
}

function anthropicFailure(status: number, payload: unknown): AiProviderFailure {
  const error = (payload as { error?: { type?: string; message?: string } } | null)?.error;
  const message = error?.message?.toLowerCase() ?? '';

  if (error?.type === 'authentication_error' || error?.type === 'permission_error') {
    return new AiProviderFailure('auth');
  }
  if (
    message.includes('credit balance') ||
    message.includes('quota') ||
    message.includes('billing')
  ) {
    return new AiProviderFailure('quota');
  }

  return failureForStatus(status);
}

function openRouterFailure(status: number, payload: unknown): AiProviderFailure {
  const code = (payload as { error?: { code?: number } } | null)?.error?.code;

  if (typeof code === 'number') {
    if (code === 401 || code === 403) return new AiProviderFailure('auth');
    if (code === 402) return new AiProviderFailure('quota');
    if (code === 429) return new AiProviderFailure('rate_limit');
    if (code === 400 || code === 404) return new AiProviderFailure('model_unavailable');
    if (code >= 500) return new AiProviderFailure('provider');
  }

  return failureForStatus(status);
}

@Injectable()
export class OpenAiProvider implements AiProviderAdapter {
  readonly id = AiProvider.OPENAI;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async complete(input: AiCompletionInput): Promise<string> {
    const result = await postJson(
      'https://api.openai.com/v1/chat/completions',
      {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      {
        model: input.model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userContent },
        ],
        reasoning_effort: 'none',
        max_completion_tokens: input.maxTokens,
        stream: false,
      },
      this.timeoutMs,
    );

    if (!result.ok) {
      throw failureForStatus(result.status);
    }

    return normalizeText(openAiContent(result.payload));
  }

  private get timeoutMs(): number {
    return this.config.get('AI_TIMEOUT_MS');
  }
}

@Injectable()
export class DeepSeekProvider implements AiProviderAdapter {
  readonly id = AiProvider.DEEPSEEK;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async complete(input: AiCompletionInput): Promise<string> {
    const result = await postJson(
      'https://api.deepseek.com/chat/completions',
      {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      {
        model: input.model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userContent },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.2,
        max_tokens: input.maxTokens,
        stream: false,
      },
      this.timeoutMs,
    );

    if (!result.ok) {
      throw failureForStatus(result.status);
    }

    return normalizeText(openAiContent(result.payload));
  }

  private get timeoutMs(): number {
    return this.config.get('AI_TIMEOUT_MS');
  }
}

@Injectable()
export class AnthropicProvider implements AiProviderAdapter {
  readonly id = AiProvider.ANTHROPIC;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async complete(input: AiCompletionInput): Promise<string> {
    const result = await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      {
        model: input.model,
        max_tokens: Math.max(input.maxTokens, 512),
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.userContent }],
      },
      this.timeoutMs,
    );

    if (!result.ok) {
      throw anthropicFailure(result.status, result.payload);
    }

    return normalizeText(anthropicContent(result.payload));
  }

  private get timeoutMs(): number {
    return this.config.get('AI_TIMEOUT_MS');
  }
}

@Injectable()
export class OpenRouterProvider implements AiProviderAdapter {
  readonly id = AiProvider.OPENROUTER;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async complete(input: AiCompletionInput): Promise<string> {
    const result = await postJson(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'OrderUp CRM',
      },
      {
        model: input.model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userContent },
        ],
        temperature: 0.2,
        max_tokens: Math.max(input.maxTokens, 256),
        stream: false,
      },
      this.timeoutMs,
    );

    if (!result.ok) {
      throw openRouterFailure(result.status, result.payload);
    }

    return normalizeText(openAiContent(result.payload));
  }

  private get timeoutMs(): number {
    return this.config.get('AI_TIMEOUT_MS');
  }
}

@Injectable()
export class AiProviderFactory {
  constructor(
    private readonly openai: OpenAiProvider,
    private readonly deepseek: DeepSeekProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly openrouter: OpenRouterProvider,
  ) {}

  get(provider: AiProvider): AiProviderAdapter {
    switch (provider) {
      case AiProvider.OPENAI:
        return this.openai;
      case AiProvider.DEEPSEEK:
        return this.deepseek;
      case AiProvider.ANTHROPIC:
        return this.anthropic;
      case AiProvider.OPENROUTER:
        return this.openrouter;
    }
  }
}
