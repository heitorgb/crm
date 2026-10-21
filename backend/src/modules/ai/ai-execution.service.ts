import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import {
  AiProviderAuthError,
  AiProviderInvalidResponseError,
  AiProviderModelUnavailableError,
  AiProviderQuotaError,
  AiProviderRateLimitError,
  AiProviderTimeoutError,
  AiProviderUnavailableError,
} from './ai.errors.js';
import { AiProviderFailure } from './ai.provider.js';
import { AiProviderFactory } from './ai.providers.js';
import { AiSettingsService, type ResolvedAiSettings } from './ai-settings.service.js';

export interface AiCompletionRequest {
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}

export interface AiCompletionResult {
  text: string;
  provider: string;
  model: string;
}

@Injectable()
export class AiExecutionService {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly providers: AiProviderFactory,
  ) {}

  resolveSettings(): Promise<ResolvedAiSettings> {
    return this.settings.getForExecution();
  }

  async complete(
    input: AiCompletionRequest,
    resolved?: ResolvedAiSettings,
  ): Promise<AiCompletionResult> {
    const settings = resolved ?? (await this.settings.getForExecution());
    const provider = this.providers.get(settings.provider);

    try {
      const text = await provider.complete({
        model: settings.model,
        apiKey: settings.apiKey,
        systemPrompt: input.systemPrompt,
        userContent: input.userContent,
        maxTokens: input.maxTokens,
      });

      return { text, provider: settings.provider, model: settings.model };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

export function toHttpError(error: unknown): AppException {
  if (error instanceof AppException) {
    return error;
  }

  if (!(error instanceof AiProviderFailure)) {
    return new AiProviderUnavailableError();
  }

  switch (error.kind) {
    case 'auth':
      return new AiProviderAuthError();
    case 'rate_limit':
      return new AiProviderRateLimitError();
    case 'quota':
      return new AiProviderQuotaError();
    case 'model_unavailable':
      return new AiProviderModelUnavailableError();
    case 'timeout':
      return new AiProviderTimeoutError();
    case 'invalid_response':
      return new AiProviderInvalidResponseError();
    case 'connection':
    case 'provider':
      return new AiProviderUnavailableError();
  }
}
