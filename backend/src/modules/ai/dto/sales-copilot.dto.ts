import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  SALES_MAX_FOLLOW_UP_ACTION_CHARS,
  SALES_MAX_FOLLOW_UP_MESSAGE_CHARS,
  SALES_MAX_FOLLOW_UP_REASON_CHARS,
  SALES_MAX_PREVIOUS_ANALYSIS_CHARS,
} from '../sales-copilot.models.js';

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

export class GetSalesCopilotContextQueryDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class UpdateSalesRecommendationDto {
  @IsIn(['ACCEPT', 'REJECT', 'CANCEL'])
  action!: 'ACCEPT' | 'REJECT' | 'CANCEL';

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(5_000)
  value?: string;
}

export class CreateSalesFollowUpDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsUUID()
  recommendationId?: string;

  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MinLength(1)
  @MaxLength(SALES_MAX_FOLLOW_UP_ACTION_CHARS)
  action!: string;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(SALES_MAX_FOLLOW_UP_REASON_CHARS)
  reason?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(SALES_MAX_FOLLOW_UP_MESSAGE_CHARS)
  suggestedMessage?: string;

  @IsUUID()
  idempotencyKey!: string;
}

export class UpdateSalesFollowUpDto {
  @IsOptional()
  @IsIn(['COMPLETED', 'CANCELED'])
  status?: 'COMPLETED' | 'CANCELED';

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(SALES_MAX_FOLLOW_UP_REASON_CHARS)
  reason?: string;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(SALES_MAX_FOLLOW_UP_MESSAGE_CHARS)
  suggestedMessage?: string;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(SALES_MAX_FOLLOW_UP_REASON_CHARS)
  result?: string;
}
