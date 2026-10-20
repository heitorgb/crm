import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import {
  CreateLeadDto,
  CreatePipelineDto,
  CreateStageDto,
  LeadBoardQueryDto,
  MoveLeadDto,
  UpdateLeadDto,
  UpdatePipelineDto,
  UpdateStageDto,
} from './dto/lead.dto.js';
import { LeadsService } from './leads.service.js';

@Controller('leads')
@RequireModule(MODULE_KEYS.CRM)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get('pipelines')
  listPipelines() {
    return this.leads.listPipelines();
  }

  @Roles('OWNER', 'ADMIN')
  @Post('pipelines')
  createPipeline(@Body() dto: CreatePipelineDto) {
    return this.leads.createPipeline(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('pipelines/:id')
  updatePipeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipelineDto,
  ) {
    return this.leads.updatePipeline(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('pipelines/:id/stages')
  createStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStageDto,
  ) {
    return this.leads.createStage(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('pipelines/:id/stages/:stageId')
  updateStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: UpdateStageDto,
  ) {
    return this.leads.updateStage(id, stageId, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('pipelines/:id/stages/:stageId')
  @HttpCode(204)
  removeStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
  ) {
    return this.leads.removeStage(id, stageId);
  }

  @Get('board')
  board(@Query() query: LeadBoardQueryDto) {
    return this.leads.board(query);
  }

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leads.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(id, dto);
  }

  @Patch(':id/stage')
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveLeadDto) {
    return this.leads.move(id, dto.stageId);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.remove(id);
  }
}
