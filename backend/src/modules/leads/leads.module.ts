import { Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

@Module({
  imports: [ModulesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
