import type { MessageTranscription, TranscriptionStatus } from '@prisma/client';

export interface MessageTranscriptionView {
  status: TranscriptionStatus;
  text: string | null;
  language: string | null;
  provider: string | null;
  model: string | null;
  attempts: number;
  retryable: boolean;
  canRetry: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  transcribedAt: Date | null;
}

export function toTranscriptionView(row: MessageTranscription): MessageTranscriptionView {
  return {
    status: row.status,
    text: row.text,
    language: row.language,
    provider: row.provider,
    model: row.model,
    attempts: row.attempts,
    retryable: row.retryable,
    canRetry:
      (row.status === 'FAILED' && row.retryable) ||
      (row.status === 'NOT_APPLICABLE' &&
        row.errorCode !== null &&
        row.errorCode !== 'AI_TRANSCRIPTION_NOT_APPLICABLE'),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    transcribedAt: row.transcribedAt,
  };
}
