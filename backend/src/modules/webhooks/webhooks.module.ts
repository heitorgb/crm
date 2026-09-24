import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { WebhookService } from './webhook.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [WhatsAppModule, ContactsModule],
  controllers: [WebhooksController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhooksModule {}
