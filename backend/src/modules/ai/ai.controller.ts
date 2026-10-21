import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  CreateSalesFollowUpDto,
  GetSalesCopilotContextQueryDto,
  SuggestSalesReplyDto,
  UpdateSalesFollowUpDto,
  UpdateSalesRecommendationDto,
} from './dto/sales-copilot.dto.js';
import { SalesCopilotService } from './sales-copilot.service.js';
import { SalesFollowUpsService } from './sales-follow-ups.service.js';
import { SalesRecommendationsService } from './sales-recommendations.service.js';

@Controller('ai')
export class AiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly ai: AiService,
    private readonly sales: SalesCopilotService,
    private readonly recommendations: SalesRecommendationsService,
    private readonly followUps: SalesFollowUpsService,
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

  @RequireModule(MODULE_KEYS.CRM)
  @Get('sales/context')
  getSalesContext(@Query() query: GetSalesCopilotContextQueryDto) {
    return this.sales.getState(query.leadId, query.conversationId);
  }

  @RequireModule(MODULE_KEYS.CRM)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-sales-recommendation-decision', limit: 30, windowMs: 60_000 })
  @Patch('sales/recommendations/:id')
  decideSalesRecommendation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesRecommendationDto,
  ) {
    return this.recommendations.decide(id, dto);
  }

  @RequireModule(MODULE_KEYS.CRM)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-sales-follow-up-create', limit: 20, windowMs: 60_000 })
  @Post('sales/follow-ups')
  @HttpCode(201)
  createSalesFollowUp(@Body() dto: CreateSalesFollowUpDto) {
    return this.followUps.create(dto);
  }

  @RequireModule(MODULE_KEYS.CRM)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-sales-follow-up-update', limit: 30, windowMs: 60_000 })
  @Patch('sales/follow-ups/:id')
  updateSalesFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesFollowUpDto,
  ) {
    return this.followUps.update(id, dto);
  }
}
