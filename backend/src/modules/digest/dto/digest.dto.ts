import { DigestChannel } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpsertDigestPreferenceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Matches(TIME_PATTERN, { message: 'deliveryTime must be in HH:mm format' })
  deliveryTime!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timeZone!: string;

  @IsOptional()
  @IsEnum(DigestChannel)
  channel?: DigestChannel;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsappDestination?: string | null;

  @IsOptional()
  @IsBoolean()
  includeOnlyAssigned?: boolean;
}

export class ListDigestDeliveriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  onlyFailed?: boolean;
}

export class RunDigestDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  timeZone?: string;
}
