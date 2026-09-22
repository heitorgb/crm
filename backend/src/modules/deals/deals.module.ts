import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module.js';
import { DealsController } from './deals.controller.js';
import { DealsService } from './deals.service.js';

@Module({
  imports: [ActivitiesModule],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
