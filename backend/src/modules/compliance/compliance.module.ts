import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module.js';
import { QualificationModule } from '../qualification/qualification.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { AutomatedReviewService } from './automated-review.service.js';
import { ComplianceController } from './compliance.controller.js';
import { ComplianceSettingsService } from './compliance-settings.service.js';
import { PersonalDataService } from './personal-data.service.js';
import { PublicComplianceController } from './public-compliance.controller.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [ActivitiesModule, QualificationModule, TicketsModule],
  controllers: [ComplianceController, PublicComplianceController],
  providers: [
    ComplianceSettingsService,
    PersonalDataService,
    AutomatedReviewService,
    RetentionService,
  ],
  exports: [PersonalDataService, RetentionService, ComplianceSettingsService],
})
export class ComplianceModule {}
