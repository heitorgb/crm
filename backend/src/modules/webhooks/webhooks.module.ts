import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { TranscriptionSettingsModule } from '../transcription/transcription-settings.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { WebhookService } from './webhook.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [WhatsAppModule, ContactsModule, ConversationsModule, TranscriptionSettingsModule],
  controllers: [WebhooksController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhooksModule {}
