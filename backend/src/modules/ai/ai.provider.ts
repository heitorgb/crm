import type { AiProvider } from '@prisma/client';

export type AiProviderFailureKind =
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'model_unavailable'
  | 'timeout'
  | 'connection'
  | 'provider'
  | 'invalid_response';

export class AiProviderFailure extends Error {
  constructor(
    readonly kind: AiProviderFailureKind,
    message = kind,
  ) {
    super(message);
    this.name = 'AiProviderFailure';
  }
}

export interface AiCompletionInput {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}

export interface AiProviderAdapter {
  readonly id: AiProvider;
  complete(input: AiCompletionInput): Promise<string>;
}
