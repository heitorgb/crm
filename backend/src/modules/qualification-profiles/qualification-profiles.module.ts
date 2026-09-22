import { Module } from '@nestjs/common';
import { QualificationProfilesController } from './qualification-profiles.controller.js';
import { QualificationProfilesService } from './qualification-profiles.service.js';

@Module({
  controllers: [QualificationProfilesController],
  providers: [QualificationProfilesService],
  exports: [QualificationProfilesService],
})
export class QualificationProfilesModule {}
