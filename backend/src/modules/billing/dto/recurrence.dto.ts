import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';
import { BILLING_RECURRENCE_FREQUENCIES } from './charge.dto.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateBillingRecurrenceDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(999_999_999)
  amountCents!: number;

  @Matches(DATE_ONLY, { message: 'startDate deve estar no formato YYYY-MM-DD' })
  startDate!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'endDate deve estar no formato YYYY-MM-DD' })
  endDate?: string;

  @IsOptional()
  @IsIn(BILLING_RECURRENCE_FREQUENCIES)
  frequency?: (typeof BILLING_RECURRENCE_FREQUENCIES)[number];
}

export class UpdateBillingRecurrenceDto {
  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999_999_999)
  amountCents?: number;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'endDate deve estar no formato YYYY-MM-DD' })
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListBillingRecurrencesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;
}
