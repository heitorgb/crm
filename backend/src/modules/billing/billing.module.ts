import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { ModulesModule } from '../modules/modules.module.js';
import { BillingChargesService } from './billing-charges.service.js';
import { BillingController } from './billing.controller.js';
import { BillingRecurrencesService } from './billing-recurrences.service.js';
import { BillingRemindersService } from './billing-reminders.service.js';
import { BillingSchedulerService } from './billing-scheduler.service.js';
import { BillingSettingsService } from './billing-settings.service.js';

@Module({
  imports: [WhatsAppModule, ModulesModule],
  controllers: [BillingController],
  providers: [
    BillingSettingsService,
    BillingRecurrencesService,
    BillingChargesService,
    BillingRemindersService,
    BillingSchedulerService,
  ],
  exports: [BillingChargesService, BillingRemindersService, BillingSettingsService],
})
export class BillingModule {}
