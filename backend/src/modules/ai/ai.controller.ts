import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { AI_FORMALITIES, AI_PROVIDERS } from './ai.models.js';
import { AiService } from './ai.service.js';
import { AiSettingsService } from './ai-settings.service.js';
import { FormalizeMessageDto, TestAiConnectionDto, UpdateAiSettingsDto } from './dto/ai.dto.js';
import {
  AnalyzeSalesOpportunityDto,
  SuggestSalesReplyDto,
} from './dto/sales-copilot.dto.js';
import { SalesCopilotService } from './sales-copilot.service.js';

@Controller('ai')
export class AiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly ai: AiService,
    private readonly sales: SalesCopilotService,
  ) {}

  @Get('catalog')
  catalog() {
    return {
      providers: AI_PROVIDERS,
      formalities: AI_FORMALITIES,
    };
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Roles('OWNER', 'ADMIN')
  @Put('settings')
  saveSettings(@Body() dto: UpdateAiSettingsDto) {
    return this.settings.save(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-test-connection', limit: 8, windowMs: 60_000 })
  @Post('test')
  @HttpCode(200)
  testConnection(@Body() dto: TestAiConnectionDto) {
    return this.ai.testConnection(dto);
  }

  @RequireModule(MODULE_KEYS.ATTENDANCE)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-formalize', limit: 20, windowMs: 60_000 })
  @Post('formalize')
  @HttpCode(200)
  formalize(@Body() dto: FormalizeMessageDto) {
    return this.ai.formalize(dto.text);
  }

  @RequireModule(MODULE_KEYS.CRM)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-sales-analyze', limit: 10, windowMs: 60_000 })
  @Post('sales/analyze')
  @HttpCode(200)
  analyzeSalesOpportunity(@Body() dto: AnalyzeSalesOpportunityDto) {
    return this.sales.analyze(dto);
  }

  @RequireModule(MODULE_KEYS.CRM)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-sales-suggest-reply', limit: 15, windowMs: 60_000 })
  @Post('sales/suggest-reply')
  @HttpCode(200)
  suggestSalesReply(@Body() dto: SuggestSalesReplyDto) {
    return this.sales.suggestReply(dto);
  }
}
