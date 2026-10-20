import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { ModulesModule } from '../modules/modules.module.js';
import { BulkMediaController } from './bulk-media.controller.js';
import { BulkMediaSchedulerService } from './bulk-media-scheduler.service.js';
import { BulkMediaService } from './bulk-media.service.js';

@Module({
  imports: [ConversationsModule, ModulesModule],
  controllers: [BulkMediaController],
  providers: [BulkMediaService, BulkMediaSchedulerService],
  exports: [BulkMediaService],
})
export class BulkMediaModule {}
