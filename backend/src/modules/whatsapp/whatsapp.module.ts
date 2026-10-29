import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module.js';
import { EvolutionClient } from './evolution/evolution.client.js';
import { WhatsAppContactSyncService } from './whatsapp-contact-sync.service.js';
import { WhatsAppConversationSyncService } from './whatsapp-conversation-sync.service.js';
import { WhatsAppDirectoryService } from './whatsapp-directory.service.js';
import { WhatsAppInstancesController } from './whatsapp-instances.controller.js';
import { WhatsAppInstancesSchedulerService } from './whatsapp-instances-scheduler.service.js';
import { WhatsAppInstancesService } from './whatsapp-instances.service.js';

@Module({
  imports: [ContactsModule, PlatformSettingsModule],
  controllers: [WhatsAppInstancesController],
  providers: [
    EvolutionClient,
    WhatsAppInstancesService,
    WhatsAppInstancesSchedulerService,
    WhatsAppDirectoryService,
    WhatsAppContactSyncService,
    WhatsAppConversationSyncService,
  ],
  exports: [
    EvolutionClient,
    WhatsAppInstancesService,
    WhatsAppDirectoryService,
    WhatsAppConversationSyncService,
  ],
})
export class WhatsAppModule {}
