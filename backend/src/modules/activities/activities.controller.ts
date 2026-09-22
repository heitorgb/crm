import { Controller, Get, Query } from '@nestjs/common';
import { ActivitiesService } from './activities.service.js';
import { ListActivitiesQueryDto } from './dto/activity.dto.js';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  list(@Query() query: ListActivitiesQueryDto) {
    return this.activities.list(query);
  }
}
