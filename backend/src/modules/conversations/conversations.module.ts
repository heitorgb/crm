import { Module } from '@nestjs/common';
import { LinkPreviewsModule } from '../link-previews/link-previews.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { ConversationProcessingService } from './conversation-processing.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [WhatsAppModule, LinkPreviewsModule],
  controllers: [ConversationsController],
  providers: [MessagesService, ConversationProcessingService, ConversationsService],
  exports: [MessagesService, ConversationProcessingService, ConversationsService],
})
export class ConversationsModule {}
