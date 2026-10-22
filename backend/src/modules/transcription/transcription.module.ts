import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { AudioConversionService } from './audio-conversion.service.js';
import { OpenAiTranscriptionProvider } from './openai-transcription.provider.js';
import { TranscriptionController } from './transcription.controller.js';
import { TranscriptionProviderFactory } from './transcription.providers.js';
import { TranscriptionService } from './transcription.service.js';
import { TranscriptionSettingsModule } from './transcription-settings.module.js';

@Module({
  imports: [ConversationsModule, TranscriptionSettingsModule],
  controllers: [TranscriptionController],
  providers: [
    TranscriptionService,
    AudioConversionService,
    TranscriptionProviderFactory,
    OpenAiTranscriptionProvider,
  ],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}
