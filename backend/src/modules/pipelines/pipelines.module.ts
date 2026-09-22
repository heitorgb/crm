import { Module } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller.js';
import { PipelinesService } from './pipelines.service.js';

@Module({
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
