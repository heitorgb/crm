import type { AiProvider } from '@prisma/client';

export type TranscriptionFailureKind =
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'model_unavailable'
  | 'timeout'
  | 'connection'
  | 'provider'
  | 'invalid_response'
  | 'file_rejected'
  | 'invalid_request';

export class TranscriptionProviderFailure extends Error {
  constructor(
    readonly kind: TranscriptionFailureKind,
    message = kind,
  ) {
    super(message);
    this.name = 'TranscriptionProviderFailure';
  }
}

export interface TranscriptionInput {
  model: string;
  apiKey: string;
  audio: Buffer;
  mimeType: string;
  fileName: string;
  language?: string;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  provider: AiProvider;
  model: string;
}

export interface SpeechToTextAdapter {
  readonly id: AiProvider;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  check(input: { apiKey: string; model: string }): Promise<void>;
}
