import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { WebhookService } from './webhook.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [WhatsAppModule],
  controllers: [WebhooksController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhooksModule {}
