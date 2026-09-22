import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { DataSubjectRequestStatus, DataSubjectRequestType } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { AutomatedReviewService } from './automated-review.service.js';
import { ComplianceSettingsService } from './compliance-settings.service.js';
import {
  AcceptLegalDocumentsDto,
  EraseLeadDto,
  ListComplianceRequestsQueryDto,
  RectifyLeadDto,
  ResolveReviewDto,
  SubjectRequestReasonDto,
  UpdateDpoSettingsDto,
  UpdateRetentionSettingsDto,
} from './dto/compliance.dto.js';
import { PersonalDataService } from './personal-data.service.js';
import { RetentionService } from './retention.service.js';

@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly settings: ComplianceSettingsService,
    private readonly personalData: PersonalDataService,
    private readonly reviews: AutomatedReviewService,
    private readonly retention: RetentionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.getSettings();
  }

  @Roles('OWNER', 'ADMIN')
  @Put('settings/dpo')
  updateDpo(@Body() dto: UpdateDpoSettingsDto) {
    return this.settings.updateDpo(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Put('settings/retention')
  updateRetention(@Body() dto: UpdateRetentionSettingsDto) {
    return this.settings.updateRetention(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('settings/legal-acceptance')
  @HttpCode(200)
  acceptLegal(@Body() dto: AcceptLegalDocumentsDto) {
    return this.settings.acceptLegalDocuments(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('requests')
  listRequests(@Query() query: ListComplianceRequestsQueryDto) {
    return this.personalData.listRequests(query);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('requests/:id')
  findRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.personalData.findRequest(id);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('subjects/leads/:leadId/access')
  async access(@Param('leadId', ParseUUIDPipe) leadId: string) {
    const data = await this.personalData.collect(leadId);
    await this.personalData.record({
      type: DataSubjectRequestType.ACCESS,
      status: DataSubjectRequestStatus.COMPLETED,
      leadId,
      details: { action: 'access' },
    });
    return data;
  }

  @Roles('OWNER', 'ADMIN')
  @Get('subjects/leads/:leadId/export')
  async export(@Param('leadId', ParseUUIDPipe) leadId: string) {
    const data = await this.personalData.collect(leadId);
    await this.personalData.record({
      type: DataSubjectRequestType.PORTABILITY,
      status: DataSubjectRequestStatus.COMPLETED,
      leadId,
      details: { action: 'portability' },
    });
    return { format: 'json', exportedAt: new Date().toISOString(), data };
  }

  @Roles('OWNER', 'ADMIN')
  @Post('subjects/leads/:leadId/rectify')
  @HttpCode(200)
  rectify(@Param('leadId', ParseUUIDPipe) leadId: string, @Body() dto: RectifyLeadDto) {
    return this.personalData.rectify(leadId, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('subjects/leads/:leadId/erase')
  @HttpCode(200)
  erase(@Param('leadId', ParseUUIDPipe) leadId: string, @Body() dto: EraseLeadDto) {
    return this.personalData.erase(leadId, dto.confirm);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('subjects/leads/:leadId/consent-revocation')
  @HttpCode(200)
  revokeConsent(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: SubjectRequestReasonDto,
  ) {
    return this.personalData.revokeConsent(leadId, dto.reason);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('subjects/leads/:leadId/opposition')
  @HttpCode(200)
  oppose(@Param('leadId', ParseUUIDPipe) leadId: string, @Body() dto: SubjectRequestReasonDto) {
    return this.personalData.oppose(leadId, dto.reason);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('reviews/sessions/:sessionId')
  reviewContext(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.reviews.context(sessionId);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('reviews/sessions/:sessionId/request')
  @HttpCode(200)
  requestReview(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.reviews.requestReview(sessionId);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('reviews/sessions/:sessionId/resolve')
  @HttpCode(200)
  resolveReview(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ResolveReviewDto,
  ) {
    return this.reviews.resolveReview(sessionId, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('retention/run')
  @HttpCode(202)
  async runRetention(): Promise<{ ok: true }> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.retention.expunge(tenantId);
    return { ok: true };
  }
}
