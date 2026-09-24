import { WhatsAppInstanceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export class WhatsAppCredentialsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookSecret?: string;
}

export class CreateWhatsAppInstanceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  instanceName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppCredentialsDto)
  credentials?: WhatsAppCredentialsDto;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateWhatsAppInstanceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsEnum(WhatsAppInstanceStatus)
  status?: WhatsAppInstanceStatus;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppCredentialsDto)
  credentials?: WhatsAppCredentialsDto;
}

export class ListWhatsAppInstancesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WhatsAppInstanceStatus)
  status?: WhatsAppInstanceStatus;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;
}
