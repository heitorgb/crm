import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AiSettingsService } from './ai-settings.service.js';
import {
  AiProviderFactory,
  AnthropicProvider,
  DeepSeekProvider,
  OpenAiProvider,
  OpenRouterProvider,
} from './ai.providers.js';

@Module({
  controllers: [AiController],
  providers: [
    AiSettingsService,
    AiService,
    AiProviderFactory,
    OpenAiProvider,
    DeepSeekProvider,
    AnthropicProvider,
    OpenRouterProvider,
  ],
  exports: [AiSettingsService, AiService, AiProviderFactory],
})
export class AiModule {}
