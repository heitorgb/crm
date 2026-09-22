import { Module } from '@nestjs/common';
import { QualificationModule } from '../qualification/qualification.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { ConversationProcessingService } from './conversation-processing.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [WhatsAppModule, QualificationModule, TicketsModule],
  controllers: [ConversationsController],
  providers: [MessagesService, ConversationProcessingService, ConversationsService],
  exports: [MessagesService, ConversationProcessingService, ConversationsService],
})
export class ConversationsModule {}
