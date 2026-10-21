import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { OpenAiTranscriptionProvider } from './openai-transcription.provider.js';
import type { SpeechToTextAdapter } from './transcription.provider.js';

@Injectable()
export class TranscriptionProviderFactory {
  constructor(private readonly openai: OpenAiTranscriptionProvider) {}

  get(provider: AiProvider): SpeechToTextAdapter {
    switch (provider) {
      case AiProvider.OPENAI:
        return this.openai;
      default:
        throw new Error(`Unsupported transcription provider: ${provider}`);
    }
  }
}
