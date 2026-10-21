import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { UpdateTranscriptionSettingsDto } from './dto/transcription.dto.js';
import { TRANSCRIPTION_PROVIDERS } from './transcription.models.js';
import { TranscriptionSettingsService } from './transcription-settings.service.js';
import { TranscriptionService } from './transcription.service.js';

@Controller('ai/transcription')
export class TranscriptionController {
  constructor(
    private readonly settings: TranscriptionSettingsService,
    private readonly transcription: TranscriptionService,
  ) {}

  @Get('catalog')
  catalog() {
    return {
      providers: TRANSCRIPTION_PROVIDERS,
      credentialPolicy: {
        reusedFrom: 'OPENAI',
        description:
          'A transcrição reutiliza a credencial OpenAI já salva na organização. Nenhuma chave adicional é armazenada.',
      },
    };
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Roles('OWNER', 'ADMIN')
  @Put('settings')
  saveSettings(@Body() dto: UpdateTranscriptionSettingsDto) {
    return this.settings.save(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-transcription-test', limit: 8, windowMs: 60_000 })
  @Post('test')
  @HttpCode(200)
  testConnection() {
    return this.transcription.testConnection();
  }

  @RequireModule(MODULE_KEYS.ATTENDANCE)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'ai-transcription-retry', limit: 10, windowMs: 60_000 })
  @Post('messages/:conversationId/:messageId/retry')
  @HttpCode(200)
  retry(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.transcription.retry(conversationId, messageId);
  }
}
