import { AiProviderUnavailableError } from './ai.errors.js';
import type { AiProvider, AiProviderInfo } from './ai-provider.types.js';

export class UnavailableAiProvider implements AiProvider {
  readonly info: AiProviderInfo = { provider: 'unavailable', model: 'none' };

  async evaluate(): Promise<unknown> {
    throw new AiProviderUnavailableError();
  }
}
