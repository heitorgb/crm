import { AiProvider } from '@prisma/client';
import {
  AI_PROVIDERS,
  defaultModelFor,
  findProvider,
  isModelSupported,
} from '../../../src/modules/ai/ai.models.js';

describe('AI provider catalog', () => {
  it('exposes exactly the four supported providers in order', () => {
    expect(AI_PROVIDERS.map((provider) => provider.id)).toEqual([
      AiProvider.OPENAI,
      AiProvider.DEEPSEEK,
      AiProvider.ANTHROPIC,
      AiProvider.OPENROUTER,
    ]);
  });

  it('keeps three recommended models per provider', () => {
    for (const provider of AI_PROVIDERS) {
      expect(provider.models).toHaveLength(3);
      expect(defaultModelFor(provider.id)).toBe(provider.models[0].id);
    }
  });

  it('uses direct Anthropic model ids and provider-prefixed OpenRouter ids', () => {
    expect(findProvider(AiProvider.ANTHROPIC).models.map((model) => model.id)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ]);

    const openRouterIds = findProvider(AiProvider.OPENROUTER).models.map((model) => model.id);
    expect(openRouterIds).toEqual([
      'anthropic/claude-haiku-5-5',
      'openai/gpt-5.4-mini',
      'google/gemini-3.1-flash-lite',
    ]);
    expect(openRouterIds.every((id) => id.includes('/'))).toBe(true);
  });

  it('rejects models from another provider', () => {
    expect(isModelSupported(AiProvider.OPENAI, 'claude-haiku-5-5')).toBe(false);
    expect(isModelSupported(AiProvider.ANTHROPIC, 'anthropic/claude-haiku-5-5')).toBe(false);
    expect(isModelSupported(AiProvider.OPENROUTER, 'anthropic/claude-haiku-5-5')).toBe(true);
    expect(isModelSupported(AiProvider.ANTHROPIC, 'claude-haiku-5-5')).toBe(true);
  });
});
