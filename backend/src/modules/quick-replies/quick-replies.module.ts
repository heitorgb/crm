import { Module } from '@nestjs/common';
import { QuickRepliesController } from './quick-replies.controller.js';
import { QuickRepliesService } from './quick-replies.service.js';

@Module({
  controllers: [QuickRepliesController],
  providers: [QuickRepliesService],
  exports: [QuickRepliesService],
})
export class QuickRepliesModule {}
