import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MODULE_KEYS } from '../../modules/modules.constants.js';
import { RequireModule } from '../../modules/require-module.decorator.js';
import { WebhookIntegrationsService } from './webhook-integrations.service.js';

@Controller('integrations/whatsapp')
@RequireModule(MODULE_KEYS.WEBHOOKS)
export class WebhookGroupsController {
  constructor(private readonly integrations: WebhookIntegrationsService) {}

  @Get(':instanceId/groups')
  listGroups(@Param('instanceId', ParseUUIDPipe) instanceId: string) {
    return this.integrations.listGroups(instanceId);
  }
}
