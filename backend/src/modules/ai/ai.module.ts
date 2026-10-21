import { Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module.js';
import { AiController } from './ai.controller.js';
import { AiExecutionService } from './ai-execution.service.js';
import { AiService } from './ai.service.js';
import { AiSettingsService } from './ai-settings.service.js';
import {
  AiProviderFactory,
  AnthropicProvider,
  DeepSeekProvider,
  OpenAiProvider,
  OpenRouterProvider,
} from './ai.providers.js';
import { SalesCopilotService } from './sales-copilot.service.js';

@Module({
  imports: [ModulesModule],
  controllers: [AiController],
  providers: [
    AiSettingsService,
    AiExecutionService,
    AiService,
    SalesCopilotService,
    AiProviderFactory,
    OpenAiProvider,
    DeepSeekProvider,
    AnthropicProvider,
    OpenRouterProvider,
  ],
  exports: [AiSettingsService, AiService, AiProviderFactory],
})
export class AiModule {}
