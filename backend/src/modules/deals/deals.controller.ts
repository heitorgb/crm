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
  CreateDealDto,
  DealBoardQueryDto,
  ListDealsQueryDto,
  MoveDealDto,
  UpdateDealDto,
} from './dto/deal.dto.js';
import { DealsService } from './deals.service.js';

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list(@Query() query: ListDealsQueryDto) {
    return this.deals.list(query);
  }

  @Get('board')
  board(@Query() query: DealBoardQueryDto) {
    return this.deals.board(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.deals.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDealDto) {
    return this.deals.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealDto) {
    return this.deals.update(id, dto);
  }

  @Patch(':id/stage')
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDealDto) {
    return this.deals.move(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deals.remove(id);
  }
}
