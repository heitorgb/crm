import { Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module.js';
import { MessagePushService } from './message-push.service.js';
import { PushDevicesController } from './push-devices.controller.js';
import { PushDevicesService } from './push-devices.service.js';

@Module({
  imports: [ModulesModule],
  controllers: [PushDevicesController],
  providers: [PushDevicesService, MessagePushService],
})
export class PushNotificationsModule {}
