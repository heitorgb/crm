import {
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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const BILLING_CHARGE_SORT_FIELDS = ['createdAt', 'dueDate', 'amountCents'] as const;
export type BillingChargeSortField = (typeof BILLING_CHARGE_SORT_FIELDS)[number];

export const BILLING_CHARGE_EFFECTIVE_STATUSES = [
  'PENDING',
  'OVERDUE',
  'PAID',
  'CANCELED',
] as const;
export type BillingChargeEffectiveStatus = (typeof BILLING_CHARGE_EFFECTIVE_STATUSES)[number];

export const BILLING_RECURRENCE_FREQUENCIES = ['MONTHLY'] as const;
export type BillingRecurrenceFrequencyInput = (typeof BILLING_RECURRENCE_FREQUENCIES)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const BILLING_MAX_AMOUNT_CENTS = 999_999_999;

export class BillingRecurrenceConfigDto {
  @IsOptional()
  @IsIn(BILLING_RECURRENCE_FREQUENCIES)
  frequency?: BillingRecurrenceFrequencyInput;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'endDate deve estar no formato YYYY-MM-DD' })
  endDate?: string;
}

export class CreateBillingChargeDto {
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
  @Max(BILLING_MAX_AMOUNT_CENTS)
  amountCents!: number;

  @Matches(DATE_ONLY, { message: 'dueDate deve estar no formato YYYY-MM-DD' })
  dueDate!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingRecurrenceConfigDto)
  recurrence?: BillingRecurrenceConfigDto;
}

export class UpdateBillingChargeDto {
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
  @Max(BILLING_MAX_AMOUNT_CENTS)
  amountCents?: number;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dueDate deve estar no formato YYYY-MM-DD' })
  dueDate?: string;
}

export class ListBillingChargesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(BILLING_CHARGE_EFFECTIVE_STATUSES)
  status?: BillingChargeEffectiveStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  recurrenceId?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dueFrom deve estar no formato YYYY-MM-DD' })
  dueFrom?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dueTo deve estar no formato YYYY-MM-DD' })
  dueTo?: string;

  @IsOptional()
  @IsIn(BILLING_CHARGE_SORT_FIELDS)
  sort: BillingChargeSortField = 'dueDate';
}

export class BillingOverviewQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}
