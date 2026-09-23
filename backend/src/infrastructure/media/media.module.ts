import { Global, Module } from '@nestjs/common';
import { MediaProcessingService } from './media-processing.service.js';

@Global()
@Module({
  providers: [MediaProcessingService],
  exports: [MediaProcessingService],
})
export class MediaModule {}
