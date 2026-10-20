import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsHexColor,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class LeadBoardQueryDto {
  @IsOptional()
  @IsUUID()
  pipelineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limitPerStage: number = 50;
}

export class CreateLeadDto {
  @IsUUID()
  pipelineId!: string;

  @IsUUID()
  stageId!: string;

  @IsUUID()
  contactId!: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  valueCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsOptional()
  @IsISO8601()
  nextFollowUpAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  tagIds?: string[];
}

export class UpdateLeadDto {
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  valueCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsOptional()
  @IsISO8601()
  nextFollowUpAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  tagIds?: string[];
}

export class MoveLeadDto {
  @IsUUID()
  stageId!: string;
}

export class CreatePipelineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdatePipelineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateStageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string | null;

  @IsOptional()
  @IsIn(['OPEN', 'WON', 'LOST'])
  kind?: 'OPEN' | 'WON' | 'LOST';
}

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string | null;

  @IsOptional()
  @IsIn(['OPEN', 'WON', 'LOST'])
  kind?: 'OPEN' | 'WON' | 'LOST';

}
