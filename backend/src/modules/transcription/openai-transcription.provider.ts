import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider } from '@prisma/client';
import type { Env } from '../../config/env.validation.js';
import {
  type SpeechToTextAdapter,
  type TranscriptionInput,
  type TranscriptionResult,
  TranscriptionProviderFailure,
} from './transcription.provider.js';

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

export function failureForResponse(
  status: number,
  payload: unknown,
  stage: 'transcription' | 'model_check' = 'transcription',
): TranscriptionProviderFailure {
  const error = (payload as {
    error?: { code?: unknown; type?: unknown; param?: unknown; message?: unknown };
  } | null)?.error;
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const type = typeof error?.type === 'string' ? error.type.toLowerCase() : '';
  const param = typeof error?.param === 'string' ? error.param.toLowerCase() : '';
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  const marker = `${code} ${type} ${message}`;

  if (marker.includes('insufficient_quota') || marker.includes('billing')) {
    return new TranscriptionProviderFailure('quota');
  }
  if (status === 401 || status === 403) return new TranscriptionProviderFailure('auth');
  if (status === 402) return new TranscriptionProviderFailure('quota');
  if (status === 429) return new TranscriptionProviderFailure('rate_limit');
  if (status === 413) return new TranscriptionProviderFailure('file_rejected');

  if (
    status === 400 &&
    (param === 'file' || message.includes('file format') || message.includes('audio format'))
  ) {
    return new TranscriptionProviderFailure('file_rejected');
  }

  if (
    code === 'model_not_found' ||
    marker.includes('model not found') ||
    marker.includes('model does not exist') ||
    marker.includes('does not have access to model') ||
    marker.includes('unsupported model')
  ) {
    return new TranscriptionProviderFailure('model_unavailable');
  }

  if (status === 404) {
    return new TranscriptionProviderFailure(
      stage === 'model_check' ? 'model_unavailable' : 'invalid_request',
    );
  }
  if (status === 400) return new TranscriptionProviderFailure('invalid_request');
  if (status >= 500) return new TranscriptionProviderFailure('provider');
  return new TranscriptionProviderFailure('provider');
}

function requestFailure(error: unknown): TranscriptionProviderFailure {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new TranscriptionProviderFailure('timeout');
  }
  return new TranscriptionProviderFailure('connection');
}

@Injectable()
export class OpenAiTranscriptionProvider implements SpeechToTextAdapter {
  readonly id = AiProvider.OPENAI;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
      input.fileName,
    );
    form.append('model', input.model);
    form.append('response_format', 'json');
    if (input.language) {
      form.append('language', input.language);
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw requestFailure(error);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw failureForResponse(response.status, payload);
    }

    const text = normalizeTranscript((payload as { text?: unknown } | null)?.text);
    if (!text) {
      throw new TranscriptionProviderFailure('invalid_response');
    }

    return {
      text,
      language: readLanguage(payload),
      provider: this.id,
      model: input.model,
    };
  }

  async check(input: { apiKey: string; model: string }): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${OPENAI_MODELS_URL}/${encodeURIComponent(input.model)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw requestFailure(error);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw failureForResponse(response.status, payload, 'model_check');
    }
  }

  private get timeoutMs(): number {
    return this.config.get('TRANSCRIPTION_TIMEOUT_MS');
  }
}

function normalizeTranscript(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

function readLanguage(payload: unknown): string | null {
  const language = (payload as { language?: unknown } | null)?.language;
  return typeof language === 'string' && language.trim().length > 0 ? language.trim() : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
