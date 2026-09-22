import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { LeadDigestController } from './lead-digest.controller.js';
import { LeadDigestService } from './lead-digest.service.js';

@Module({
  imports: [ActivitiesModule, WhatsAppModule],
  controllers: [LeadDigestController],
  providers: [LeadDigestService],
  exports: [LeadDigestService],
})
export class DigestModule {}
