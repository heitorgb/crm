import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const BILLING_REMINDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'SKIPPED',
] as const;

export type BillingReminderStatusValue = (typeof BILLING_REMINDER_STATUSES)[number];

export class ListBillingRemindersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(BILLING_REMINDER_STATUSES)
  status?: BillingReminderStatusValue;

  @IsOptional()
  @IsUUID()
  chargeId?: string;
}

export class SendBillingReminderDto {
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotencyKey!: string;
}
