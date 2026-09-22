import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorators.js';
import {
  EvaluateQualificationMessageDto,
  ListQualificationSessionsQueryDto,
  StartQualificationSessionDto,
} from './dto/qualification.dto.js';
import { QualificationSessionsService } from './qualification-sessions.service.js';

@Controller('qualification-sessions')
export class QualificationSessionsController {
  constructor(private readonly sessions: QualificationSessionsService) {}

  @Get()
  list(@Query() query: ListQualificationSessionsQueryDto) {
    return this.sessions.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.findOne(id);
  }

  @Post(':id/messages')
  evaluate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EvaluateQualificationMessageDto) {
    return this.sessions.evaluate(id, dto);
  }

  @Post(':id/review')
  requestReview(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.requestReview(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/reanalyze')
  reanalyze(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.reanalyze(id);
  }
}

@Controller('leads')
export class LeadQualificationController {
  constructor(private readonly sessions: QualificationSessionsService) {}

  @Post(':leadId/qualification-sessions')
  start(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: StartQualificationSessionDto,
  ) {
    return this.sessions.start(leadId, dto);
  }
}
