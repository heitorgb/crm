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
import {
  CreatePipelineDto,
  CreatePipelineStageDto,
  ListPipelinesQueryDto,
  UpdatePipelineDto,
  UpdatePipelineStageDto,
} from './dto/pipeline.dto.js';
import { PipelinesService } from './pipelines.service.js';

@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  list(@Query() query: ListPipelinesQueryDto) {
    return this.pipelines.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pipelines.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePipelineDto) {
    return this.pipelines.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePipelineDto) {
    return this.pipelines.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.pipelines.remove(id);
  }

  @Get(':id/stages')
  listStages(@Param('id', ParseUUIDPipe) id: string) {
    return this.pipelines.listStages(id);
  }

  @Post(':id/stages')
  createStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePipelineStageDto,
  ) {
    return this.pipelines.createStage(id, dto);
  }

  @Patch(':id/stages/:stageId')
  updateStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: UpdatePipelineStageDto,
  ) {
    return this.pipelines.updateStage(id, stageId, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id/stages/:stageId')
  @HttpCode(204)
  async removeStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
  ): Promise<void> {
    await this.pipelines.removeStage(id, stageId);
  }
}
