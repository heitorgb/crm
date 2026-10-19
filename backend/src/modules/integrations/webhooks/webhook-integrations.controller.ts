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
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { MODULE_KEYS } from '../../modules/modules.constants.js';
import { RequireModule } from '../../modules/require-module.decorator.js';
import {
  CreateWebhookIntegrationDto,
  ListWebhookExecutionsQueryDto,
  ListWebhookIntegrationsQueryDto,
  UpdateWebhookIntegrationDto,
} from './dto/webhook.dto.js';
import { WebhookExecutionService } from './webhook-execution.service.js';
import { WebhookIntegrationsService } from './webhook-integrations.service.js';

@Controller('integrations/webhooks')
@RequireModule(MODULE_KEYS.WEBHOOKS)
export class WebhookIntegrationsController {
  constructor(
    private readonly integrations: WebhookIntegrationsService,
    private readonly executions: WebhookExecutionService,
  ) {}

  @Get()
  list(@Query() query: ListWebhookIntegrationsQueryDto) {
    return this.integrations.list(query);
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  create(@Body() dto: CreateWebhookIntegrationDto) {
    return this.integrations.create(dto);
  }

  @Get(':id/executions')
  listExecutions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListWebhookExecutionsQueryDto,
  ) {
    return this.executions.listExecutions(id, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.findOne(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookIntegrationDto,
  ) {
    return this.integrations.update(id, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/regenerate-secret')
  @HttpCode(200)
  regenerateSecret(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.regenerateSecret(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.integrations.remove(id);
  }
}
