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
import { ListBillingRemindersQueryDto, SendBillingReminderDto } from './dto/reminder.dto.js';
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
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  overview(@Query() query: BillingOverviewQueryDto) {
    return this.charges.overview(query);
  }

  @Get('charges')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  listCharges(@Query() query: ListBillingChargesQueryDto) {
    return this.charges.list(query);
  }

  @Get('charges/:id')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  findCharge(@Param('id', ParseUUIDPipe) id: string) {
    return this.charges.findOne(id);
  }

  @Get('charges/:id/reminders')
  @RequireModule(MODULE_KEYS.BILLING_COLLECTION)
  listChargeReminders(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.reminders.list({ ...query, chargeId: id } as ListBillingRemindersQueryDto);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_COLLECTION)
  @Post('charges/:id/reminders')
  @HttpCode(201)
  sendManualReminder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendBillingReminderDto,
  ) {
    return this.reminders.sendManual(id, dto.idempotencyKey);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  @Post('charges')
  createCharge(@Body() dto: CreateBillingChargeDto) {
    return this.charges.create(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  @Patch('charges/:id')
  updateCharge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBillingChargeDto) {
    return this.charges.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  @Post('charges/:id/pay')
  @HttpCode(200)
  payCharge(@Param('id', ParseUUIDPipe) id: string) {
    return this.charges.pay(id);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  @Post('charges/:id/cancel')
  @HttpCode(200)
  cancelCharge(@Param('id', ParseUUIDPipe) id: string) {
    return this.charges.cancel(id);
  }

  @Get('reminders')
  @RequireModule(MODULE_KEYS.BILLING_COLLECTION)
  listReminders(@Query() query: ListBillingRemindersQueryDto) {
    return this.reminders.list(query);
  }

  @Get('recurrences')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  listRecurrences(@Query() query: ListBillingRecurrencesQueryDto) {
    return this.recurrences.list(query);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  @Post('recurrences')
  createRecurrence(@Body() dto: CreateBillingRecurrenceDto) {
    return this.recurrences.create(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  @Patch('recurrences/:id')
  updateRecurrence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBillingRecurrenceDto) {
    return this.recurrences.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_CHARGES)
  @Delete('recurrences/:id')
  deactivateRecurrence(@Param('id', ParseUUIDPipe) id: string) {
    return this.recurrences.deactivate(id);
  }

  @Get('settings')
  @RequireModule(MODULE_KEYS.BILLING_COLLECTION)
  getSettings() {
    return this.settings.get();
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.BILLING_COLLECTION)
  @Patch('settings')
  updateSettings(@Body() dto: UpdateBillingSettingsDto) {
    return this.settings.update(dto);
  }
}
