import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SALES_MAX_PREVIOUS_ANALYSIS_CHARS } from '../sales-copilot.models.js';

function trimmedOrUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const result = value.trim();
  return result.length > 0 ? result : undefined;
}

export class AnalyzeSalesOpportunityDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class SuggestSalesReplyDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(SALES_MAX_PREVIOUS_ANALYSIS_CHARS)
  previousAnalysis?: string;
}
