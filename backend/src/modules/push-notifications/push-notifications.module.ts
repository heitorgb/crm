import { Module } from '@nestjs/common';
import { MessagePushService } from './message-push.service.js';
import { PushDevicesController } from './push-devices.controller.js';
import { PushDevicesService } from './push-devices.service.js';

@Module({
  controllers: [PushDevicesController],
  providers: [PushDevicesService, MessagePushService],
})
export class PushNotificationsModule {}
