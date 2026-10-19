import { Module } from '@nestjs/common';
import { ConversationsModule } from '../../conversations/conversations.module.js';
import { ModulesModule } from '../../modules/modules.module.js';
import { WhatsAppModule } from '../../whatsapp/whatsapp.module.js';
import { WebhookExecutionController } from './webhook-execution.controller.js';
import { WebhookExecutionService } from './webhook-execution.service.js';
import { WebhookGroupsController } from './webhook-groups.controller.js';
import { WebhookIntegrationsController } from './webhook-integrations.controller.js';
import { WebhookIntegrationsService } from './webhook-integrations.service.js';

@Module({
  imports: [WhatsAppModule, ConversationsModule, ModulesModule],
  controllers: [
    WebhookIntegrationsController,
    WebhookGroupsController,
    WebhookExecutionController,
  ],
  providers: [WebhookIntegrationsService, WebhookExecutionService],
  exports: [WebhookIntegrationsService, WebhookExecutionService],
})
export class IntegrationsWebhooksModule {}
