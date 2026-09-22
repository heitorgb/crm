import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation.js';
import type { AiProvider } from './ai-provider.types.js';
import { AI_PROVIDER } from './ai-provider.types.js';
import { HttpAiProvider } from './http-ai.provider.js';
import { UnavailableAiProvider } from './unavailable-ai.provider.js';

export const aiProviderProvider = {
  provide: AI_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): AiProvider => {
    const provider = config.get('AI_PROVIDER');
    const model = config.get('AI_MODEL');
    const apiKey = config.get('AI_API_KEY');

    if (!provider || !model || !apiKey) {
      return new UnavailableAiProvider();
    }

    return new HttpAiProvider({
      provider,
      model,
      apiKey,
      baseUrl: config.get('AI_BASE_URL') ?? undefined,
      timeoutMs: config.getOrThrow('AI_TIMEOUT_MS'),
      maxRetries: config.getOrThrow('AI_MAX_RETRIES'),
    });
  },
};
