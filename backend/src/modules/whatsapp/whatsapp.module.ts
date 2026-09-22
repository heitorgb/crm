import { Module } from '@nestjs/common';
import { EvolutionClient } from './evolution/evolution.client.js';
import { WhatsAppInstancesController } from './whatsapp-instances.controller.js';
import { WhatsAppInstancesService } from './whatsapp-instances.service.js';

@Module({
  controllers: [WhatsAppInstancesController],
  providers: [EvolutionClient, WhatsAppInstancesService],
  exports: [EvolutionClient, WhatsAppInstancesService],
})
export class WhatsAppModule {}
