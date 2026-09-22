import { QualificationOutcome, QualificationSessionStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export class StartQualificationSessionDto {
  @IsOptional()
  @IsUUID()
  profileId?: string;
}

export class EvaluateQualificationMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}

export class ListQualificationSessionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsEnum(QualificationSessionStatus)
  status?: QualificationSessionStatus;
}

export class ListLeadAnalysesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsEnum(QualificationOutcome)
  outcome?: QualificationOutcome;
}
