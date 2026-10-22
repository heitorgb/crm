import { Module } from '@nestjs/common';
import { TranscriptionSettingsService } from './transcription-settings.service.js';

@Module({
  providers: [TranscriptionSettingsService],
  exports: [TranscriptionSettingsService],
})
export class TranscriptionSettingsModule {}
