import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { ModulesModule } from '../modules/modules.module.js';
import { ScheduledMessageSenderService } from './scheduled-message-sender.service.js';
import { ScheduledMessagesController } from './scheduled-messages.controller.js';
import { ScheduledMessagesSchedulerService } from './scheduled-messages-scheduler.service.js';
import { ScheduledMessagesService } from './scheduled-messages.service.js';

@Module({
  imports: [ConversationsModule, ModulesModule],
  controllers: [ScheduledMessagesController],
  providers: [
    ScheduledMessagesService,
    ScheduledMessageSenderService,
    ScheduledMessagesSchedulerService,
  ],
  exports: [ScheduledMessagesService],
})
export class ScheduledMessagesModule {}
