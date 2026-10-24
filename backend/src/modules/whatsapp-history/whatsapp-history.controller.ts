import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { BackfillWhatsAppHistoryDto } from './dto/whatsapp-history.dto.js';
import { WhatsAppHistoryService } from './whatsapp-history.service.js';

@Controller('whatsapp/instances')
export class WhatsAppHistoryController {
  constructor(private readonly history: WhatsAppHistoryService) {}

  @Roles('OWNER', 'ADMIN')
  @Post(':id/backfill')
  @HttpCode(200)
  backfill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BackfillWhatsAppHistoryDto,
  ) {
    return this.history.backfill(id, dto ?? {});
  }
}
