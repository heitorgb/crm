import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { WhatsAppHistoryController } from './whatsapp-history.controller.js';
import { WhatsAppHistoryService } from './whatsapp-history.service.js';

@Module({
  imports: [WhatsAppModule, WebhooksModule],
  controllers: [WhatsAppHistoryController],
  providers: [WhatsAppHistoryService],
})
export class WhatsAppHistoryModule {}
