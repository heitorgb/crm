import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { ModulesModule } from '../modules/modules.module.js';
import { StoreOrdersController } from './store-orders.controller.js';
import { StoreOrdersService } from './store-orders.service.js';
import { StoreOrderDeliverySchedulerService } from './store-order-delivery-scheduler.service.js';

@Module({
  imports: [ModulesModule, ConversationsModule],
  controllers: [StoreOrdersController],
  providers: [StoreOrdersService, StoreOrderDeliverySchedulerService],
})
export class StoreOrdersModule {}
