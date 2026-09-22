import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListLeadAnalysesQueryDto } from './dto/qualification.dto.js';
import { QualificationSessionsService } from './qualification-sessions.service.js';

@Controller('lead-analyses')
export class LeadAnalysesController {
  constructor(private readonly sessions: QualificationSessionsService) {}

  @Get()
  list(@Query() query: ListLeadAnalysesQueryDto) {
    return this.sessions.listAnalyses(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.findAnalysis(id);
  }
}
