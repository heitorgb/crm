import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { ListDigestDeliveriesQueryDto, UpsertDigestPreferenceDto } from './dto/digest.dto.js';
import { LeadDigestService } from './lead-digest.service.js';

@Controller('settings/lead-digest')
export class LeadDigestController {
  constructor(private readonly digest: LeadDigestService) {}

  @Get('preference')
  getPreference() {
    return this.digest.getPreference();
  }

  @Put('preference')
  upsertPreference(@Body() dto: UpsertDigestPreferenceDto) {
    return this.digest.upsertPreference(dto);
  }

  @Get('deliveries')
  listDeliveries(@Query() query: ListDigestDeliveriesQueryDto) {
    return this.digest.listDeliveries(query);
  }

  @Get('overview')
  overview() {
    return this.digest.overview();
  }

  @Roles('OWNER', 'ADMIN')
  @Post('run')
  @HttpCode(202)
  async run(): Promise<{ ok: true }> {
    await this.digest.runNow();
    return { ok: true };
  }
}
