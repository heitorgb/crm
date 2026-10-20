import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module.js';
import { LinkPreviewsController } from './link-previews.controller.js';
import { LinkPreviewsService } from './link-previews.service.js';

@Module({
  imports: [PlatformSettingsModule],
  controllers: [LinkPreviewsController],
  providers: [LinkPreviewsService],
  exports: [LinkPreviewsService],
})
export class LinkPreviewsModule {}
