import { Module } from '@nestjs/common';
import { EvolutionClient } from './evolution/evolution.client.js';
import { WhatsAppDirectoryService } from './whatsapp-directory.service.js';
import { WhatsAppInstancesController } from './whatsapp-instances.controller.js';
import { WhatsAppInstancesService } from './whatsapp-instances.service.js';

@Module({
  controllers: [WhatsAppInstancesController],
  providers: [EvolutionClient, WhatsAppInstancesService, WhatsAppDirectoryService],
  exports: [EvolutionClient, WhatsAppInstancesService, WhatsAppDirectoryService],
})
export class WhatsAppModule {}
