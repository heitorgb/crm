import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Public } from '../auth/decorators/auth.decorators.js';
import { ComplianceSettingsService } from './compliance-settings.service.js';
import { DataSubjectNotFoundError } from './compliance.errors.js';

@Controller('compliance')
export class PublicComplianceController {
  constructor(private readonly settings: ComplianceSettingsService) {}

  @Public()
  @Get('tenants/:tenantId/dpo')
  async getDpo(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    const result = await this.settings.getPublicDpo(tenantId);
    if (!result) {
      throw new DataSubjectNotFoundError();
    }
    return result;
  }
}
