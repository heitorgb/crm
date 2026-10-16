import { IsIn, IsOptional, IsUUID } from 'class-validator';
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
