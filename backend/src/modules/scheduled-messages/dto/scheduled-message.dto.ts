import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const SCHEDULED_MESSAGE_STATUSES = [
  'SCHEDULED',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELED',
] as const;

export const SCHEDULED_MESSAGE_TYPES = ['CAMPAIGN', 'REMINDER'] as const;

export class ListScheduledMessagesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SCHEDULED_MESSAGE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(SCHEDULED_MESSAGE_TYPES)
  type?: string;
}
