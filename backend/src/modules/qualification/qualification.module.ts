import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module.js';
import { aiProviderProvider } from './ai/ai-provider.factory.js';
import { LeadAnalysesController } from './lead-analyses.controller.js';
import { QualificationEngineService } from './qualification-engine.service.js';
import {
  LeadQualificationController,
  QualificationSessionsController,
} from './qualification-sessions.controller.js';
import { QualificationSessionsService } from './qualification-sessions.service.js';

@Module({
  imports: [ActivitiesModule],
  controllers: [
    QualificationSessionsController,
    LeadAnalysesController,
    LeadQualificationController,
  ],
  providers: [aiProviderProvider, QualificationEngineService, QualificationSessionsService],
  exports: [QualificationSessionsService, QualificationEngineService],
})
export class QualificationModule {}
