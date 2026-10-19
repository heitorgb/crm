import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { ResolveLinkPreviewsDto } from './dto/link-preview.dto.js';
import { LinkPreviewsService } from './link-previews.service.js';

@Controller('link-previews')
@RequireModule(MODULE_KEYS.ATTENDANCE)
export class LinkPreviewsController {
  constructor(private readonly linkPreviews: LinkPreviewsService) {}

  @Post('resolve')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'link-preview-resolve', limit: 120, windowMs: 60_000 })
  async resolve(@Body() dto: ResolveLinkPreviewsDto) {
    const previews = await this.linkPreviews.resolveForCurrentTenant(dto.urls);
    return { previews };
  }
}
