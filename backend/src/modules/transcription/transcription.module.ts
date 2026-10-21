import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { AudioConversionService } from './audio-conversion.service.js';
import { OpenAiTranscriptionProvider } from './openai-transcription.provider.js';
import { TranscriptionController } from './transcription.controller.js';
import { TranscriptionProviderFactory } from './transcription.providers.js';
import { TranscriptionService } from './transcription.service.js';
import { TranscriptionSettingsService } from './transcription-settings.service.js';

@Module({
  imports: [ConversationsModule],
  controllers: [TranscriptionController],
  providers: [
    TranscriptionSettingsService,
    TranscriptionService,
    AudioConversionService,
    TranscriptionProviderFactory,
    OpenAiTranscriptionProvider,
  ],
  exports: [TranscriptionService, TranscriptionSettingsService],
})
export class TranscriptionModule {}
