import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import {
  AiProviderAuthError,
  AiProviderInvalidResponseError,
  AiProviderModelUnavailableError,
  AiProviderQuotaError,
  AiProviderRateLimitError,
  AiProviderTimeoutError,
  AiProviderUnavailableError,
  AiRequestInProgressError,
} from './ai.errors.js';
import { buildFormalizationSystemPrompt } from './ai.prompt.js';
import { AiProviderFailure } from './ai.provider.js';
import { AiProviderFactory } from './ai.providers.js';
import { AI_MAX_OUTPUT_TOKENS, AI_TEST_MAX_TOKENS } from './ai.models.js';
import { AiSettingsService } from './ai-settings.service.js';
import type { TestAiConnectionDto } from './dto/ai.dto.js';

const TEST_SYSTEM_PROMPT =
  'Você é um teste de conectividade. Responda apenas com a palavra OK, sem explicações.';

export interface AiFormalizationResult {
  text: string;
}

export interface AiConnectionTestResult {
  ok: true;
  provider: string;
  model: string;
  message: string;
}

@Injectable()
export class AiService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly settings: AiSettingsService,
    private readonly providers: AiProviderFactory,
    private readonly tenantContext: TenantContextService,
  ) {}

  async testConnection(dto: TestAiConnectionDto): Promise<AiConnectionTestResult> {
    const resolved = await this.settings.resolveForTest(dto);
    const provider = this.providers.get(dto.provider);

    try {
      await provider.complete({
        model: dto.model,
        apiKey: resolved.apiKey,
        systemPrompt: TEST_SYSTEM_PROMPT,
        userContent: 'Teste de conexão.',
        maxTokens: AI_TEST_MAX_TOKENS,
      });
    } catch (error) {
      throw toHttpError(error);
    }

    return {
      ok: true,
      provider: dto.provider,
      model: dto.model,
      message: 'Conexão validada com sucesso.',
    };
  }

  async formalize(text: string): Promise<AiFormalizationResult> {
    const { tenantId, userId } = this.tenantContext.requireContext();
    const lockKey = `${tenantId}:${userId}`;

    if (this.inFlight.has(lockKey)) {
      throw new AiRequestInProgressError();
    }

    this.inFlight.add(lockKey);
    try {
      const settings = await this.settings.getForExecution();
      const provider = this.providers.get(settings.provider);

      const result = await provider.complete({
        model: settings.model,
        apiKey: settings.apiKey,
        systemPrompt: buildFormalizationSystemPrompt(settings.formality),
        userContent: text,
        maxTokens: AI_MAX_OUTPUT_TOKENS,
      });

      return { text: result };
    } catch (error) {
      throw toHttpError(error);
    } finally {
      this.inFlight.delete(lockKey);
    }
  }
}

function toHttpError(error: unknown): AppException {
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
