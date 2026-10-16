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
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { BillingChargesService } from './billing-charges.service.js';
import { BillingRecurrencesService } from './billing-recurrences.service.js';
import { BillingRemindersService } from './billing-reminders.service.js';
import { BillingSettingsService } from './billing-settings.service.js';
import {
  BillingOverviewQueryDto,
  CreateBillingChargeDto,
  ListBillingChargesQueryDto,
  UpdateBillingChargeDto,
} from './dto/charge.dto.js';
import {
  CreateBillingRecurrenceDto,
  ListBillingRecurrencesQueryDto,
  UpdateBillingRecurrenceDto,
} from './dto/recurrence.dto.js';
import { ListBillingRemindersQueryDto } from './dto/reminder.dto.js';
import { UpdateBillingSettingsDto } from './dto/settings.dto.js';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly charges: BillingChargesService,
    private readonly recurrences: BillingRecurrencesService,
    private readonly reminders: BillingRemindersService,
    private readonly settings: BillingSettingsService,
  ) {}

  @Get('overview')
  overview(@Query() query: BillingOverviewQueryDto) {
    return this.charges.overview(query);
  }

  @Get('charges')
  listCharges(@Query() query: ListBillingChargesQueryDto) {
    return this.charges.list(query);
  }

  @Get('charges/:id')
  findCharge(@Param('id', ParseUUIDPipe) id: string) {
    return this.charges.findOne(id);
  }

  @Get('charges/:id/reminders')
  listChargeReminders(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.reminders.list({ ...query, chargeId: id } as ListBillingRemindersQueryDto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('charges')
  createCharge(@Body() dto: CreateBillingChargeDto) {
    return this.charges.create(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('charges/:id')
  updateCharge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBillingChargeDto) {
    return this.charges.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('charges/:id/pay')
  @HttpCode(200)
  payCharge(@Param('id', ParseUUIDPipe) id: string) {
    return this.charges.pay(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('charges/:id/cancel')
  @HttpCode(200)
  cancelCharge(@Param('id', ParseUUIDPipe) id: string) {
    return this.charges.cancel(id);
  }

  @Get('reminders')
  listReminders(@Query() query: ListBillingRemindersQueryDto) {
    return this.reminders.list(query);
  }

  @Get('recurrences')
  listRecurrences(@Query() query: ListBillingRecurrencesQueryDto) {
    return this.recurrences.list(query);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('recurrences')
  createRecurrence(@Body() dto: CreateBillingRecurrenceDto) {
    return this.recurrences.create(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('recurrences/:id')
  updateRecurrence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBillingRecurrenceDto) {
    return this.recurrences.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('recurrences/:id')
  deactivateRecurrence(@Param('id', ParseUUIDPipe) id: string) {
    return this.recurrences.deactivate(id);
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('settings')
  updateSettings(@Body() dto: UpdateBillingSettingsDto) {
    return this.settings.update(dto);
  }
}
