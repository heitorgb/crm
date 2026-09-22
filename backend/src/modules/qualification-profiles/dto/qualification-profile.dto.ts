import { DataSensitivityLevel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const QUALIFICATION_PROFILE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'version',
] as const;

export type QualificationProfileSortField = (typeof QUALIFICATION_PROFILE_SORT_FIELDS)[number];

export class ProfileItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class RequiredInformationItemDto extends ProfileItemDto {
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class CriterionItemDto extends ProfileItemDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  weight?: number;
}

export class CreateQualificationProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  businessContext?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  botName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  initialMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  privacyNoticeText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  objective?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RequiredInformationItemDto)
  requiredInformation?: RequiredInformationItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CriterionItemDto)
  qualificationCriteria?: CriterionItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CriterionItemDto)
  disqualificationCriteria?: CriterionItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProfileItemDto)
  completionCriteria?: ProfileItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  qualifiedMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  disqualifiedMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  needsHumanMessage?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProfileItemDto)
  humanHandoffRules?: ProfileItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProfileItemDto)
  qualificationLevels?: ProfileItemDto[];

  @IsOptional()
  @IsEnum(DataSensitivityLevel)
  dataSensitivityLevel?: DataSensitivityLevel;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateQualificationProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  businessContext?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  botName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  initialMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  privacyNoticeText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  objective?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RequiredInformationItemDto)
  requiredInformation?: RequiredInformationItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CriterionItemDto)
  qualificationCriteria?: CriterionItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CriterionItemDto)
  disqualificationCriteria?: CriterionItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProfileItemDto)
  completionCriteria?: ProfileItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  qualifiedMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  disqualifiedMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  needsHumanMessage?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProfileItemDto)
  humanHandoffRules?: ProfileItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProfileItemDto)
  qualificationLevels?: ProfileItemDto[];

  @IsOptional()
  @IsEnum(DataSensitivityLevel)
  dataSensitivityLevel?: DataSensitivityLevel;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListQualificationProfilesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsIn(QUALIFICATION_PROFILE_SORT_FIELDS)
  sort: QualificationProfileSortField = 'createdAt';
}
