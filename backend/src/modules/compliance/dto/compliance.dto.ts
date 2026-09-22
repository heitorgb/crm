import { AutomatedReviewOutcome, DataSubjectRequestStatus, DataSubjectRequestType } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export class UpdateDpoSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;
}

export class UpdateRetentionSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  conversationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  leadDays?: number;
}

export class AcceptLegalDocumentsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  termsVersion!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  dpaVersion!: string;
}

export class RectifyLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;
}

export class EraseLeadDto {
  @IsBoolean()
  confirm!: boolean;
}

export class SubjectRequestReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ResolveReviewDto {
  @IsEnum(AutomatedReviewOutcome)
  outcome!: AutomatedReviewOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ListComplianceRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DataSubjectRequestType)
  type?: DataSubjectRequestType;

  @IsOptional()
  @IsEnum(DataSubjectRequestStatus)
  status?: DataSubjectRequestStatus;

  @IsOptional()
  @IsUUID()
  leadId?: string;
}
